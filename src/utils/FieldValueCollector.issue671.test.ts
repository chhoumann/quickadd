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

	it("includes inline fields inside allowlisted code blocks only when configured", async () => {
		const app = new App();
		const file = { path: "folder/note.md" } as any;

		app.vault.getMarkdownFiles = () => [file];
		app.metadataCache.getFileCache = () => ({ frontmatter: {} } as any);
		app.vault.read = vi.fn(async () => `
Id:: 343434
\`\`\`ad-note
Id:: 121212
\`\`\`
\`\`\`js
Id:: 999999
\`\`\`
`);

		const withoutCodeBlockAllowlist = await collectFieldValuesProcessed(
			app,
			"Id",
			{ inline: true },
		);
		const withCodeBlockAllowlist = await collectFieldValuesProcessed(app, "Id", {
			inline: true,
			inlineCodeBlocks: ["ad-note"],
		});

		expect(withoutCodeBlockAllowlist).toEqual(["343434"]);
		expect(withCodeBlockAllowlist).toEqual(["121212", "343434"]);
	});
});
