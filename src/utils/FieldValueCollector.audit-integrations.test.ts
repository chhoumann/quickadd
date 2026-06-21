import { beforeEach, describe, expect, it, vi } from "vitest";
import { App, TFile } from "obsidian";
import { FieldSuggestionCache } from "./FieldSuggestionCache";
import { collectFieldValuesProcessed } from "./FieldValueCollector";

// Dataview IS installed in these tests. The query API returns a sentinel value
// that would only ever come from the Dataview branch, so we can prove whether
// that branch ran.
const dataviewQuery = vi.fn(async () => ({
	successful: true,
	value: { values: [[null, "from-dataview"]] },
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

	it("honors exclude-file even when Dataview is available by bypassing Dataview", async () => {
		const app = new App();

		const templateFile = makeFile("Template.md");
		const realFile = makeFile("notes/Real.md");
		app.vault.getMarkdownFiles = () => [templateFile, realFile];
		app.metadataCache.getFileCache = (file: TFile) => {
			if (file.path === "Template.md") {
				return { frontmatter: { project: "TemplateValue" } } as any;
			}
			return { frontmatter: { project: "RealValue" } } as any;
		};

		const values = await collectFieldValuesProcessed(app, "project", {
			excludeFiles: ["Template.md"],
		});

		// Dataview must NOT have been consulted (its sentinel would otherwise win).
		expect(values).not.toContain("from-dataview");
		// The excluded file's value is dropped, the other file's value remains.
		expect(values).not.toContain("TemplateValue");
		expect(values).toContain("RealValue");
	});

	it("still uses Dataview when no exclude-file filter is present", async () => {
		const app = new App();
		app.vault.getMarkdownFiles = () => [];

		const values = await collectFieldValuesProcessed(app, "project", {});

		expect(values).toContain("from-dataview");
		expect(dataviewQuery).toHaveBeenCalled();
	});
});
