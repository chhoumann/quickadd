import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import type { IChoiceExecutor } from "./IChoiceExecutor";
import type QuickAdd from "./main";
import { QuickAddApi } from "./quickAddApi";

vi.mock("./quickAddSettingsTab", () => ({
	DEFAULT_SETTINGS: {},
	QuickAddSettingsTab: class {},
}));

vi.mock("./formatters/completeFormatter", () => ({
	CompleteFormatter: class CompleteFormatterMock {},
}));

vi.mock("obsidian-dataview", () => ({
	getAPI: vi.fn(),
}));

const INLINE_CONTENT = `
Id:: 343434

\`\`\`ad-note
Id:: 121212
\`\`\`

\`\`\`js
Id:: 999999
\`\`\`
`;

function createApp(content: string): App {
	const file = { path: "QuickAdd-Issue-998/repro.md" } as TFile;
	return {
		vault: {
			getMarkdownFiles: () => [file],
			read: vi.fn(async () => content),
		},
		metadataCache: {
			getFileCache: vi.fn(() => ({ frontmatter: {} })),
		},
	} as unknown as App;
}

describe("QuickAddApi.fieldSuggestions.getFieldValues", () => {
	let variables: Map<string, unknown>;
	let choiceExecutor: IChoiceExecutor;
	let plugin: QuickAdd;

	beforeEach(() => {
		variables = new Map<string, unknown>();
		choiceExecutor = {
			execute: vi.fn(),
			variables,
		} as unknown as IChoiceExecutor;
		plugin = {} as QuickAdd;
	});

	it("keeps code-block values excluded by default when includeInline is true", async () => {
		const app = createApp(INLINE_CONTENT);
		const api = QuickAddApi.GetApi(app, plugin, choiceExecutor);

		const result = await api.fieldSuggestions.getFieldValues("Id", {
			includeInline: true,
		});

		expect(result).toEqual(["343434"]);
	});

	it("includes allowlisted code-block values when includeInlineCodeBlocks is provided", async () => {
		const app = createApp(INLINE_CONTENT);
		const api = QuickAddApi.GetApi(app, plugin, choiceExecutor);

		const result = await api.fieldSuggestions.getFieldValues("Id", {
			includeInline: true,
			includeInlineCodeBlocks: ["ad-note"],
		});

		expect(result).toEqual(["121212", "343434"]);
	});

	it("does not scan inline values when includeInline is false", async () => {
		const app = createApp(INLINE_CONTENT);
		const api = QuickAddApi.GetApi(app, plugin, choiceExecutor);

		const result = await api.fieldSuggestions.getFieldValues("Id", {
			includeInline: false,
			includeInlineCodeBlocks: ["ad-note"],
		});

		expect(result).toEqual([]);
	});
});
