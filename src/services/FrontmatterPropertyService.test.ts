import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import { log } from "../logger/logManager";
import { TemplatePropertyCollector } from "../utils/TemplatePropertyCollector";
import { FrontmatterPropertyService } from "./FrontmatterPropertyService";

function file(path: string, extension = "md"): TFile {
	const result = new TFile();
	result.path = path;
	result.extension = extension;
	return result;
}

describe("FrontmatterPropertyService", () => {
	let app: App;
	let service: FrontmatterPropertyService;
	let frontmatter: Record<string, unknown>;

	beforeEach(() => {
		frontmatter = {};
		app = {
			fileManager: {
				processFrontMatter: vi.fn(async (_file: TFile, callback) => {
					callback(frontmatter);
				}),
			},
		} as unknown as App;
		service = new FrontmatterPropertyService(app);
		vi.spyOn(log, "logError").mockImplementation(() => {});
		vi.spyOn(log, "logWarning").mockImplementation(() => {});
		vi.spyOn(log, "logMessage").mockImplementation(() => {});
	});

	it("gates post-processing to markdown files with collected variables", () => {
		expect(
			service.shouldPostProcessFrontMatter(
				file("note.md", "md"),
				new Map([["key", "value"]]),
			),
		).toBe(true);
		expect(
			service.shouldPostProcessFrontMatter(file("note.md", "md"), new Map()),
		).toBe(false);
		expect(
			service.shouldPostProcessFrontMatter(
				file("board.canvas", "canvas"),
				new Map([["key", "value"]]),
			),
		).toBe(false);
		expect(
			service.shouldPostProcessFrontMatter(
				file("data.base", "base"),
				new Map([["key", "value"]]),
			),
		).toBe(false);
	});

	it("assigns nested frontmatter paths through object containers", async () => {
		frontmatter.project = null;
		frontmatter.replaceArray = [];
		const separator = TemplatePropertyCollector.PATH_SEPARATOR;

		await service.postProcessFrontMatter(
			file("note.md"),
			new Map<string, unknown>([
				[`project${separator}sources`, ["[[A]]", "[[B]]"]],
				[`replaceArray${separator}child`, true],
			]),
		);

		expect(frontmatter).toEqual({
			project: { sources: ["[[A]]", "[[B]]"] },
			replaceArray: { child: true },
		});
	});

	it("coerces valid @date values and passes invalid dates through", async () => {
		await service.postProcessFrontMatter(
			file("note.md"),
			new Map<string, unknown>([
				["valid", "@date:2024-01-15T10:30:00.000Z"],
				["invalid", "@date:not-a-date"],
			]),
		);

		expect(frontmatter.valid).toBeInstanceOf(Date);
		expect((frontmatter.valid as Date).toISOString()).toBe(
			"2024-01-15T10:30:00.000Z",
		);
		expect(frontmatter.invalid).toBe("@date:not-a-date");
	});

	it("does not throw or process frontmatter for invalid structured variables", async () => {
		await expect(
			service.postProcessFrontMatter(
				file("note.md"),
				new Map<string, unknown>([["callback", () => {}]]),
			),
		).resolves.toBeUndefined();

		expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();
		expect(log.logError).toHaveBeenCalledWith(
			expect.stringContaining("Cannot post-process front matter for file note.md"),
		);
	});

	it("logs processFrontMatter failures without rethrowing", async () => {
		vi.mocked(app.fileManager.processFrontMatter).mockRejectedValueOnce(
			new Error("yaml broke"),
		);

		await expect(
			service.postProcessFrontMatter(
				file("note.md"),
				new Map<string, unknown>([["key", "value"]]),
			),
		).resolves.toBeUndefined();

		expect(log.logError).toHaveBeenCalledWith(
			expect.stringContaining("Failed to post-process front matter for file note.md"),
		);
	});
});
