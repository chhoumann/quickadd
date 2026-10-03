import { beforeEach, describe, expect, it } from "vitest";
import { App } from "obsidian";
import { FieldSuggestionCache } from "./FieldSuggestionCache";
import { collectFieldValuesProcessed } from "./FieldValueCollector";

describe("Issue #2108 - FIELD values past the first 1,000", () => {
	beforeEach(() => {
		FieldSuggestionCache.getInstance().clear();
	});

	it("offers every value again when the second prompt reads the cache", async () => {
		const app = new App();
		const files = Array.from({ length: 1500 }, (_, i) => ({ path: `Books/${i}.md`, author: `Author ${i}` }));
		app.vault.getMarkdownFiles = () => files as any[];
		app.metadataCache.getFileCache = (file: any) => ({ frontmatter: { author: file.author } }) as any;

		const first = await collectFieldValuesProcessed(app, "author", {});
		const second = await collectFieldValuesProcessed(app, "author", {});

		expect(first).toHaveLength(1500);
		expect(second).toEqual(first);
	});
});
