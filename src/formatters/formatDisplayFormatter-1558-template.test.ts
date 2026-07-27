import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import { FormatDisplayFormatter } from "./formatDisplayFormatter";
import type QuickAdd from "../main";
import { LogManager } from "../logger/logManager";
import type { ILogger } from "../logger/ilogger";

/**
 * If the preview ever reaches the runtime engine again, these mocks record it.
 * Real ones would open a modal / run a user script.
 */
const spies = vi.hoisted(() => ({
	templateEngineRuns: [] as string[],
	macroEngineRuns: [] as string[],
	prompts: [] as string[],
}));

vi.mock("../engine/SingleTemplateEngine", () => ({
	SingleTemplateEngine: class {
		constructor(
			_app: unknown,
			_plugin: unknown,
			public templatePath: string,
		) {}
		run(): Promise<string> {
			spies.templateEngineRuns.push(this.templatePath);
			return Promise.resolve("RUNTIME ENGINE RAN");
		}
	},
}));

vi.mock("../engine/SingleMacroEngine", () => ({
	SingleMacroEngine: class {
		runAndGetOutput(name: string): Promise<string> {
			spies.macroEngineRuns.push(name);
			return Promise.resolve("MACRO RAN");
		}
		getVariables() {
			return new Map();
		}
	},
}));

vi.mock("../gui/InputPrompt", () => ({
	default: class {
		factory() {
			return {
				Prompt: async (_app: unknown, header: string) => {
					spies.prompts.push(header);
					return "PROMPTED";
				},
			};
		}
	},
}));

let templates: Record<string, string> = {};
let reported: string[] = [];

function makeApp(): App {
	return {
		workspace: { getActiveFile: () => null },
		vault: {
			getMarkdownFiles: () => [],
			getAbstractFileByPath: (path: string) =>
				path in templates
					? Object.assign(new TFile(), {
							path,
							extension: "md",
							basename: path.replace(/\.md$/, ""),
						})
					: null,
			cachedRead: async (file: { path: string }) => templates[file.path],
		},
		metadataCache: { getFileCache: () => null, getAllPropertyInfos: () => ({}) },
	} as unknown as App;
}

const plugin = {
	settings: { globalVariables: {}, choices: [] },
	getTemplateFiles: () => [],
} as unknown as QuickAdd;

beforeEach(() => {
	templates = {};
	reported = [];
	spies.templateEngineRuns.length = 0;
	spies.macroEngineRuns.length = 0;
	spies.prompts.length = 0;
	LogManager.loggers = [
		{
			logError: (m: string) => reported.push(`error ${m}`),
			logWarning: (m: string) => reported.push(`warning ${m}`),
			logMessage: () => {},
		} as unknown as ILogger,
	];
});

/**
 * Issue #1558. `FormatDisplayFormatter.getTemplateContent` used to build a
 * `SingleTemplateEngine`, whose base `TemplateEngine` constructs a real
 * `CompleteFormatter`. So typing `{{TEMPLATE:x.md}}` into a builder field ran the
 * RUN-TIME formatter over that template on every keystroke - proven live on
 * Obsidian 1.13.0 by a blocking "whoAreYou / Ok / Cancel" modal appearing on top
 * of the settings window, and by the run's warning Notices firing for tokens
 * inside the included template.
 */
describe("#1558 previewing {{TEMPLATE:...}} is inert", () => {
	it("never reaches the runtime template engine", async () => {
		templates["Note.md"] = "hello";
		const f = new FormatDisplayFormatter(makeApp(), plugin);

		await f.format("{{TEMPLATE:Note.md}}");

		expect(spies.templateEngineRuns).toEqual([]);
	});

	it("never prompts for a {{VALUE}} inside the included template", async () => {
		templates["Note.md"] = "Hi {{VALUE:whoAreYou}}";
		const f = new FormatDisplayFormatter(makeApp(), plugin);

		const out = await f.format("{{TEMPLATE:Note.md}}");

		expect(spies.prompts).toEqual([]);
		expect(out).toContain("Hi ");
		expect(out).not.toContain("{{VALUE");
	});

	it("never runs a macro inside the included template", async () => {
		templates["Note.md"] = "x {{MACRO:DoSomething}}";
		const f = new FormatDisplayFormatter(makeApp(), plugin);

		await f.format("{{TEMPLATE:Note.md}}");

		expect(spies.macroEngineRuns).toEqual([]);
	});

	it("collects a bad token inside the template instead of firing a Notice", async () => {
		templates["Note.md"] = "{{VALUE:x|case:pasc}}";
		const f = new FormatDisplayFormatter(makeApp(), plugin);

		await f.format("{{TEMPLATE:Note.md}}");

		expect(reported).toEqual([]);
		expect(
			f.diagnostics.list().some((d) => d.message.includes("Unsupported |case")),
		).toBe(true);
	});

	it("does not expand linebreak escapes inside an included body (#527)", async () => {
		// `\nabla` and a Windows path are template CONTENT, not format-template
		// material: the runtime never expands escapes on substituted content.
		templates["Note.md"] = String.raw`\nabla and C:\Users\nadia`;
		const f = new FormatDisplayFormatter(makeApp(), plugin);

		const out = await f.format("{{TEMPLATE:Note.md}}");

		expect(out).toBe(String.raw`\nabla and C:\Users\nadia`);
		expect(out).not.toContain("\n");
	});

	it("still expands linebreak escapes typed in the field itself", async () => {
		const f = new FormatDisplayFormatter(makeApp(), plugin);
		expect(await f.format(String.raw`a\nb`)).toBe("a\nb");
	});

	it("says the template is missing without pretending it failed for another reason", async () => {
		const f = new FormatDisplayFormatter(makeApp(), plugin);
		expect(await f.format("{{TEMPLATE:Gone.md}}")).toBe(
			"[QuickAdd: template not found] Gone.md",
		);
	});

	it("reports a self-including template as a cycle, at the preview level", async () => {
		templates["Loop.md"] = "before {{TEMPLATE:Loop.md}} after";
		const f = new FormatDisplayFormatter(makeApp(), plugin);

		const out = await f.format("{{TEMPLATE:Loop.md}}");

		expect(out).toContain("template inclusion cycle detected");
		// The cycle report is a preview diagnostic, not a 15-second error Notice.
		expect(reported).toEqual([]);
		expect(f.diagnostics.hasError).toBe(true);
		// The same sentence is ALSO spliced into the output as a placeholder, so
		// the inline copy is unwrapped and unbranded rather than repeating the
		// bracketed text verbatim twenty pixels below it.
		const [entry] = f.diagnostics.list();
		expect(entry.message.startsWith("[")).toBe(false);
		expect(entry.message.startsWith("QuickAdd:")).toBe(false);
		expect(entry.message).toContain("template inclusion cycle detected");
	});

	it("stops a long include chain at the inclusion depth limit", async () => {
		for (let i = 0; i < 15; i++) {
			templates[`T${i}.md`] = `${i} {{TEMPLATE:T${i + 1}.md}}`;
		}
		templates["T15.md"] = "end";
		const f = new FormatDisplayFormatter(makeApp(), plugin);

		const out = await f.format("{{TEMPLATE:T0.md}}");

		expect(out).toContain("max template inclusion depth");
		expect(reported).toEqual([]);
	});

	it("resolves a normal nested include", async () => {
		templates["Outer.md"] = "outer {{TEMPLATE:Inner.md}}";
		templates["Inner.md"] = "inner";
		const f = new FormatDisplayFormatter(makeApp(), plugin);

		expect(await f.format("[{{TEMPLATE:Outer.md}}]")).toBe("[outer inner]");
	});
});
