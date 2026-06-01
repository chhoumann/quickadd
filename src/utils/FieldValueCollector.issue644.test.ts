import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { FieldSuggestionCache } from "./FieldSuggestionCache";
import { collectFieldValuesProcessed } from "./FieldValueCollector";

vi.mock("obsidian-dataview", () => ({
	getAPI: () => null,
}));

describe("Issue #644 - quoted FIELD values in frontmatter", () => {
	beforeEach(() => {
		FieldSuggestionCache.getInstance().clear();
	});

	it("excludes unresolved FIELD tokens from collected frontmatter suggestions", async () => {
		const app = new App();
		const files = [
			{ path: "templates/quoted-field.md" },
			{ path: "notes/task.md" },
		] as any[];

		app.vault.getMarkdownFiles = () => files;
		app.metadataCache.getFileCache = (file: any) => {
			if (file.path === "templates/quoted-field.md") {
				return { frontmatter: { type: "{{FIELD:type}}" } } as any;
			}

			return { frontmatter: { type: "Task" } } as any;
		};

		const values = await collectFieldValuesProcessed(app, "type", {});

		expect(values).toEqual(["Task"]);
	});
});
