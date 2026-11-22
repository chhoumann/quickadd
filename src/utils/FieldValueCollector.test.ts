import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import type { CachedMetadata, TFile } from "obsidian";
import { FieldSuggestionCache } from "./FieldSuggestionCache";
import { collectFieldValuesProcessed, generateFieldCacheKey } from "./FieldValueCollector";
import { FieldSuggestionParser } from "./FieldSuggestionParser";

/** An app whose vault holds `files`, each with the frontmatter `frontmatterOf` returns. */
function vaultWith<F extends { path: string }>(
	files: F[],
	frontmatterOf: (file: F) => Record<string, unknown> = () => ({}),
): App {
	const app = new App();
	app.vault.getMarkdownFiles = () => files as unknown as TFile[];
	app.metadataCache.getFileCache = (file: TFile) =>
		({ frontmatter: frontmatterOf(file as unknown as F) }) as CachedMetadata;
	return app;
}

describe("collectFieldValuesProcessed", () => {
	beforeEach(() => {
		FieldSuggestionCache.getInstance().clear();
	});

	it("excludes unresolved FIELD tokens from collected frontmatter suggestions (#644)", async () => {
		const app = vaultWith([{ path: "templates/quoted-field.md" }, { path: "notes/task.md" }], (file) => ({
			type: file.path === "templates/quoted-field.md" ? "{{FIELD:type}}" : "Task",
		}));

		expect(await collectFieldValuesProcessed(app, "type", {})).toEqual(["Task"]);
	});

	it("includes tags from the vault tag index (#671)", async () => {
		const app = vaultWith([]);
		// @ts-expect-error - getTags exists in Obsidian but is not typed
		app.metadataCache.getTags = () => ({
			"#ai/technology": 1,
			"#cook/hoven": 1,
		});

		expect(await collectFieldValuesProcessed(app, "tags", {})).toEqual(
			expect.arrayContaining(["ai/technology", "cook/hoven"]),
		);
	});

	it("includes inline fields inside allowlisted code blocks only when configured (#671)", async () => {
		const app = vaultWith([{ path: "folder/note.md" }]);
		app.vault.cachedRead = vi.fn(async () => `
Id:: 343434
\`\`\`ad-note
Id:: 121212
\`\`\`
\`\`\`js
Id:: 999999
\`\`\`
`);

		const withoutCodeBlockAllowlist = await collectFieldValuesProcessed(app, "Id", { inline: true });
		const withCodeBlockAllowlist = await collectFieldValuesProcessed(app, "Id", {
			inline: true,
			inlineCodeBlocks: ["ad-note"],
		});

		expect(withoutCodeBlockAllowlist).toEqual(["343434"]);
		expect(withCodeBlockAllowlist).toEqual(["121212", "343434"]);
	});

	it("offers every value past the first 1,000 again when the second prompt reads the cache (#2108)", async () => {
		const files = Array.from({ length: 1500 }, (_, i) => ({ path: `Books/${i}.md`, author: `Author ${i}` }));
		const app = vaultWith(files, (file) => ({ author: file.author }));

		const first = await collectFieldValuesProcessed(app, "author", {});
		const second = await collectFieldValuesProcessed(app, "author", {});

		expect(first).toHaveLength(1500);
		expect(second).toEqual(first);
	});
});

describe("generateFieldCacheKey", () => {
	it("keeps one folder named with a comma apart from two folders", () => {
		const key = (input: string) => generateFieldCacheKey(FieldSuggestionParser.parse(input).filters);

		expect(key("status|exclude-folder:A,B")).not.toBe(key("status|exclude-folder:A|exclude-folder:B"));
	});
});
