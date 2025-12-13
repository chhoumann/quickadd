import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { FieldSuggestionCache } from "./FieldSuggestionCache";
import { collectFieldValuesProcessed } from "./FieldValueCollector";

vi.mock("obsidian-dataview", () => ({
	getAPI: () => null,
}));

describe("Issue #671 - {{FIELD:tags}} suggestions", () => {
	beforeEach(() => {
		FieldSuggestionCache.getInstance().clear();
	});

	it("includes tags from the vault tag index", async () => {
		const app = new App();

		// @ts-expect-error - getTags exists in Obsidian but is not typed
		app.metadataCache.getTags = () => ({
			"#ai/technology": 1,
			"#cook/hoven": 1,
		});

		app.vault.getMarkdownFiles = () => [];

		const values = await collectFieldValuesProcessed(app, "tags", {});

		expect(values).toEqual(
			expect.arrayContaining(["ai/technology", "cook/hoven"]),
		);
	});
});
