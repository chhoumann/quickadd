import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
import { createChoiceExecutor } from "../../tests/helpers/createChoiceExecutor";
import type QuickAdd from "../main";
import { CompleteFormatter } from "./completeFormatter";
import { SingleTemplateEngine } from "../engine/SingleTemplateEngine";

const { prompt } = vi.hoisted(() => ({
	prompt: vi.fn<() => Promise<string>>(),
}));

vi.mock("../gui/InputPrompt", () => ({
	default: class {
		factory() {
			return { Prompt: prompt, PromptWithContext: prompt };
		}
	},
}));
vi.mock("obsidian-dataview", () => ({ getAPI: () => null }));
vi.mock("../main", async () =>
	(await import("../../tests/helpers/formatters/mocks")).mainMock(),
);
vi.mock("../logger/logManager", async () =>
	(await import("../../tests/helpers/formatters/mocks")).logManagerMock(),
);

function makeHarness(templates: Record<string, string> = {}) {
	const files = new Map(Object.keys(templates).map((path) => [
		path,
		Object.assign(new TFile(), {
			path,
			basename: path.replace(/\.md$/, ""),
			extension: "md",
		}),
	]));
	const app = {
		workspace: { getActiveFile: () => null, getActiveViewOfType: () => null },
		vault: {
			getAbstractFileByPath: (path: string) => files.get(path) ?? null,
			cachedRead: async (file: TFile) => templates[file.path],
		},
		metadataCache: { getFileCache: () => null, getAllPropertyInfos: () => ({}) },
		fileManager: { generateMarkdownLink: () => "" },
		plugins: { plugins: {} },
	} as unknown as App;
	const plugin = {
		settings: {
			globalVariables: {},
			choices: [],
			inputPrompt: "single-line",
			enableTemplatePropertyTypes: false,
		},
	} as unknown as QuickAdd;
	const executor = createChoiceExecutor();
	const formatter = new CompleteFormatter(app, plugin, executor);
	const formatTemplate = (input: string) => formatter.withPromptScope(
		"noteBody", input, () => formatter.formatTemplateContent(input),
	);
	return { app, plugin, executor, formatter, formatTemplate };
}

beforeEach(() => {
	prompt.mockReset();
	prompt.mockResolvedValue("answer");
});

describe("Template cursor formatting scope", () => {
	it("preserves markers for an explicitly rendered Template body", async () => {
		const { formatTemplate } = makeHarness();
		const input = "😀 before{{cursor}}middle{{CURSOR}}after";
		expect(await formatTemplate(input)).toBe(input);
	});

	it("strips markers from default note bodies and generic API formatting", async () => {
		const { formatter } = makeHarness();
		const input = "before{{CURSOR}}after";
		expect(await formatter.withPromptScope("noteBody", input, () =>
			formatter.formatFileContent(input),
		)).toBe("beforeafter");
		expect(await formatter.formatFileContent(input)).toBe("beforeafter");
		expect(await formatter.formatTemplateContent(input)).toBe("beforeafter");
	});

	it.each([false, true])("restores preservation after a nested render (throws: %s)", async (throws) => {
		const { formatter, formatTemplate } = makeHarness();
		prompt.mockImplementationOnce(async () => {
			if (throws) {
				await expect(formatter.formatFileContent("{{TEMPLATE:Missing.md}}"))
					.rejects.toThrow("Template file not found");
				return "recovered";
			}
			return await formatter.formatFileContent("nested{{CURSOR}}text");
		});
		expect(await formatTemplate("before{{CURSOR}}{{VALUE:answer}}after"))
			.toBe(`before{{CURSOR}}${throws ? "recovered" : "nestedtext"}after`);
		expect(await formatter.formatFileContent("later{{CURSOR}}text")).toBe("latertext");
	});

	it("does not preserve markers in a later render after a Template render fails", async () => {
		const { formatter, formatTemplate } = makeHarness();
		await expect(formatTemplate("{{CURSOR}}{{TEMPLATE:Missing.md}}"))
			.rejects.toThrow("Template file not found");
		expect(await formatter.withPromptScope("noteBody", "later{{CURSOR}}text", () =>
			formatter.formatFileContent("later{{CURSOR}}text"),
		)).toBe("latertext");
	});

	it("propagates preservation through real nested template includes only when opted in", async () => {
		const { formatter, formatTemplate } = makeHarness({
			"Outer.md": "outer{{CURSOR}}{{TEMPLATE:Inner.md}}",
			"Inner.md": "inner{{cursor}}end",
		});
		const input = "[{{TEMPLATE:Outer.md}}]";
		expect(await formatTemplate(input)).toBe("[outer{{CURSOR}}inner{{cursor}}end]");
		expect(await formatter.withPromptScope("noteBody", input, () =>
			formatter.formatFileContent(input),
		)).toBe("[outerinnerend]");
		expect(await formatter.formatFileContent(input)).toBe("[outerinnerend]");
	});

	it("strips markers from a Capture seed rendered by SingleTemplateEngine", async () => {
		const { app, plugin, executor } = makeHarness({
			"Seed.md": "seed{{CURSOR}}{{TEMPLATE:Inner.md}}",
			"Inner.md": "inner{{cursor}}end",
		});
		const engine = new SingleTemplateEngine(app, plugin, "Seed.md", executor);
		engine.setDestinationPath("Captured.md");
		expect(await engine.run()).toBe("seedinnerend");
	});

	it("keeps Capture body includes eligible for their existing cursor compiler", async () => {
		const { formatter } = makeHarness({ "Snippet.md": "before{{CURSOR}}after" });
		const input = "{{TEMPLATE:Snippet.md}}";
		expect(await formatter.withPromptScope("captureText", input, () =>
			formatter.formatFileContent(input),
		)).toBe("before{{CURSOR}}after");
	});

	it("strips markers from paths and properties during a preserved Template render", async () => {
		const { formatter, executor, formatTemplate } = makeHarness({
			"Snippet.md": "before{{CURSOR}}after",
		});
		executor.variables.set("propertyValue", ["before{{CURSOR}}after", "{{cursor}}end"]);
		prompt.mockImplementationOnce(async () => {
			expect(await formatter.formatFileName("{{TEMPLATE:Snippet.md}}")).toBe("beforeafter");
			expect(await formatter.formatFolderPath("{{TEMPLATE:Snippet.md}}")).toBe("beforeafter");
			expect(await formatter.formatTemplateFilePath("Templates/{{CURSOR}}Seed.md"))
				.toBe("Templates/Seed.md");
			expect(await formatter.formatPropertyName("before{{CURSOR}}after")).toBe("beforeafter");
			expect(await formatter.formatPropertyValue("{{PROPERTY}}"))
				.toEqual(["beforeafter", "end"]);
			return "done";
		});
		expect(await formatTemplate("{{CURSOR}}{{VALUE:answer}}"))
			.toBe("{{CURSOR}}done");
	});
});
