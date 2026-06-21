import { beforeEach, describe, expect, it, vi } from "vitest";
import { App, TFile } from "obsidian";
import { FieldSuggestionCache } from "./FieldSuggestionCache";
import { collectFieldValuesProcessed } from "./FieldValueCollector";

// Dataview IS installed in these tests. The query API returns TABLE rows shaped
// [fileLink, fieldValue]; the first column carries the file (with .path), which
// the collector uses to honor exclude-file WITHOUT abandoning Dataview's richer
// value parsing (comma-splitting, link/file-object handling).
const dataviewQuery = vi.fn(async () => ({
	successful: true,
	value: {
		values: [
			[{ path: "Template.md" }, "TemplateValue"],
			[{ path: "notes/Real.md" }, "RealValue"],
			[{ path: "notes/Multi.md" }, "A, B"], // comma value -> Dataview splits it
		],
	},
}));

vi.mock("obsidian-dataview", () => ({
	getAPI: () => ({ query: dataviewQuery }),
}));

function makeFile(path: string): TFile {
	const file = new TFile();
	file.path = path;
	file.name = path.split("/").pop() ?? path;
	file.basename = file.name.replace(/\.md$/, "");
	file.extension = "md";
	return file;
}

describe("FieldValueCollector - exclude-file with Dataview installed (integrations audit)", () => {
	beforeEach(() => {
		FieldSuggestionCache.getInstance().clear();
		dataviewQuery.mockClear();
	});

	it("honors exclude-file via the Dataview path, dropping the excluded file's row while keeping Dataview's parsing", async () => {
		const app = new App();
		// No markdown files, so any value can only come from the Dataview branch.
		app.vault.getMarkdownFiles = () => [];

		const values = await collectFieldValuesProcessed(app, "project", {
			excludeFiles: ["Template.md"],
		});

		// Dataview IS used now (not bypassed), so its row handling is preserved.
		expect(dataviewQuery).toHaveBeenCalled();
		// The excluded file's row is dropped...
		expect(values).not.toContain("TemplateValue");
		// ...while a non-excluded file's value remains...
		expect(values).toContain("RealValue");
		// ...and Dataview's comma-splitting still yields separate values
		// (manual fallback would have returned a single "A, B" suggestion).
		expect(values).toContain("A");
		expect(values).toContain("B");
		expect(values).not.toContain("A, B");
	});

	it("matches exclude-file by basename when given a full path target, too", async () => {
		const app = new App();
		app.vault.getMarkdownFiles = () => [];

		const values = await collectFieldValuesProcessed(app, "project", {
			excludeFiles: ["notes/Real.md"],
		});

		expect(values).not.toContain("RealValue");
		expect(values).toContain("TemplateValue");
	});

	it("still uses Dataview when no exclude-file filter is present", async () => {
		const app = new App();
		app.vault.getMarkdownFiles = () => [];

		const values = await collectFieldValuesProcessed(app, "project", {});

		expect(dataviewQuery).toHaveBeenCalled();
		expect(values).toContain("TemplateValue");
		expect(values).toContain("RealValue");
	});
});
