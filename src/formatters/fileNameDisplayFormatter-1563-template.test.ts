import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import { FileNameDisplayFormatter } from "./fileNameDisplayFormatter";
import type QuickAdd from "../main";
import { LogManager } from "../logger/logManager";
import type { ILogger } from "../logger/ilogger";

/**
 * If the preview ever reaches the runtime engine, these mocks record it. Real
 * ones would open a modal / run a user script - the #1558 failure, on the field
 * next door.
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
let activeFile: { basename: string; path: string; parent: { path: string } } | null =
	null;

function makeApp(): App {
	return {
		workspace: { getActiveFile: () => activeFile },
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

function makeFormatter(): FileNameDisplayFormatter {
	return new FileNameDisplayFormatter(makeApp(), plugin);
}

beforeEach(() => {
	templates = {};
	reported = [];
	activeFile = null;
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
 * Issue #1563. `CompleteFormatter.formatFileName` resolves `{{TEMPLATE:...}}` -
 * `format()` runs `replaceTemplateInString`, and path prompt scope is
 * deliberately propagated into the child engine - but the file-name PREVIEW
 * never called it, so the builder said `{{TEMPLATE:Naming.md}}-My Note` while the
 * run produced whatever Naming.md rendered to.
 */
describe("#1563 the file-name preview resolves {{TEMPLATE:}}", () => {
	it("shows the name the run will produce", async () => {
		templates["Templates/Naming.md"] = "{{VALUE:title}}\n";

		expect(
			await makeFormatter().format("{{TEMPLATE:Templates/Naming.md}}"),
		).toBe("Example Title");
	});

	it("resolves the include before {{VALUE}}, as the run does", async () => {
		// A body whose own tokens resolve, spliced into a name that has more text
		// after it. The template file's trailing newline collapses to one space
		// at the seam - the run's normalizer does exactly this to the finished
		// name, so the two agree instead of differing by a space.
		templates["N.md"] = "Log {{VALUE:title}}\n";

		expect(await makeFormatter().format("{{TEMPLATE:N.md}}-suffix")).toBe(
			"Log Example Title -suffix",
		);
	});

	it("joins a multi-line body into one line, and says that it did", async () => {
		templates["Body.md"] = "---\ntitle: x\n---\n\n# Heading\n\nNotes\n";
		const f = makeFormatter();

		const out = await f.format("{{TEMPLATE:Body.md}}");

		expect(out).toBe("--- title: x --- # Heading Notes");
		expect(f.diagnostics.list()).toEqual([
			{
				severity: "warning",
				message:
					'Template "Body.md" is 5 lines; a file name is one line, so they are joined with spaces.',
			},
			{
				// The frontmatter's "title: x" is now IN the name, so the name has a
				// colon in it and Obsidian would refuse it (#1578).
				severity: "error",
				kind: "path",
				message:
					'A file or folder name cannot contain ":", so this choice would fail at run time. Check your own text and tokens like {{TIME}}, which is HH:mm.',
			},
		]);
	});

	it("stays quiet about the trailing newline every one-line template has", async () => {
		templates["N.md"] = "Just a name\n";
		const f = makeFormatter();

		expect(await f.format("{{TEMPLATE:N.md}}")).toBe("Just a name");
		expect(f.diagnostics.list()).toEqual([]);
	});

	it("resolves an included body with CONTENT token semantics, as the run does", async () => {
		// At run time the body goes through the child engine's formatFileContent,
		// which resolves {{linkcurrent}} / {{linksection}}; the file-name pass
		// deliberately leaves them literal, so an include previewed with the
		// file-name pass list would diverge on exactly the tokens templates carry.
		activeFile = { basename: "Active", path: "Notes/Active.md", parent: { path: "Notes" } };
		templates["N.md"] = "{{linkcurrent}} in {{foldercurrent}}";

		expect(await makeFormatter().format("{{TEMPLATE:N.md}}")).toBe(
			"Active in Notes",
		);
	});

	it("leaves {{linkcurrent}} typed into the field itself literal, as the run does", async () => {
		activeFile = { basename: "Active", path: "Notes/Active.md", parent: { path: "Notes" } };

		expect(await makeFormatter().format("{{linkcurrent}}-x")).toBe(
			"{{linkcurrent}}-x",
		);
	});
});

describe("#1563 the file-name preview stays inert (#1558's contract)", () => {
	it("never reaches the runtime template engine", async () => {
		templates["N.md"] = "hello";

		await makeFormatter().format("{{TEMPLATE:N.md}}");

		expect(spies.templateEngineRuns).toEqual([]);
	});

	it("never prompts for a {{VALUE}} inside the included template", async () => {
		templates["N.md"] = "Hi {{VALUE:whoAreYou}}";

		const out = await makeFormatter().format("{{TEMPLATE:N.md}}");

		expect(spies.prompts).toEqual([]);
		expect(out).not.toContain("{{VALUE");
	});

	it("never runs a macro inside the included template", async () => {
		templates["N.md"] = "x {{MACRO:DoSomething}}";

		await makeFormatter().format("{{TEMPLATE:N.md}}");

		expect(spies.macroEngineRuns).toEqual([]);
	});

	it("collects a bad token inside the template instead of firing a Notice", async () => {
		templates["N.md"] = "{{VALUE:x|case:pasc}}";
		const f = makeFormatter();

		await f.format("{{TEMPLATE:N.md}}");

		expect(reported).toEqual([]);
		expect(
			f.diagnostics.list().some((d) => d.message.includes("Unsupported |case")),
		).toBe(true);
	});
});

describe("#1563 the file-name preview bounds and reports include failures", () => {
	it("says the template is missing, as an error the run would abort on", async () => {
		const f = makeFormatter();

		expect(await f.format("{{TEMPLATE:Gone.md}}")).toBe(
			"[QuickAdd: template not found] Gone.md",
		);
		expect(f.diagnostics.list()).toEqual([
			{ severity: "error", message: "Template not found: Gone.md" },
		]);
		expect(reported).toEqual([]);
	});

	it("reports a self-including template as a cycle", async () => {
		templates["Loop.md"] = "before {{TEMPLATE:Loop.md}} after";
		const f = makeFormatter();

		const out = await f.format("{{TEMPLATE:Loop.md}}");

		expect(out).toContain("template inclusion cycle detected");
		expect(f.diagnostics.hasError).toBe(true);
		expect(reported).toEqual([]);
	});

	it("stops a long include chain at the inclusion depth limit", async () => {
		for (let i = 0; i < 15; i++) {
			templates[`T${i}.md`] = `${i} {{TEMPLATE:T${i + 1}.md}}`;
		}
		templates["T15.md"] = "end";
		const f = makeFormatter();

		expect(await f.format("{{TEMPLATE:T0.md}}")).toContain(
			"max template inclusion depth",
		);
		expect(reported).toEqual([]);
	});

	it("terminates when a global snippet keeps re-arming the include", async () => {
		// The template pass runs BEFORE global expansion (matching the run), so
		// each expansion hands `replaceTemplateInString` a fresh token with the
		// cycle set already unwound. Only the per-pass budget ends this.
		(plugin as unknown as { settings: { globalVariables: Record<string, string> } })
			.settings.globalVariables = { g: "{{TEMPLATE:A.md}}" };
		templates["A.md"] = "{{GLOBAL_VAR:g}}";
		const f = makeFormatter();

		const out = await f.format("{{TEMPLATE:A.md}}");

		expect(out).toContain("too many template includes");
		expect(f.diagnostics.hasError).toBe(true);
		(plugin as unknown as { settings: { globalVariables: Record<string, string> } })
			.settings.globalVariables = {};
	});

	it("leaves a {{TEMPLATE:}} produced by a global literal, as the run does", async () => {
		// The run's template pass has already gone by when globals expand, so the
		// token survives into the name. Resolving it here would be a new lie.
		(plugin as unknown as { settings: { globalVariables: Record<string, string> } })
			.settings.globalVariables = { naming: "{{TEMPLATE:N.md}}" };
		templates["N.md"] = "resolved";

		expect(await makeFormatter().format("{{GLOBAL_VAR:naming}}")).toBe(
			"{{TEMPLATE:N.md}}",
		);
		(plugin as unknown as { settings: { globalVariables: Record<string, string> } })
			.settings.globalVariables = {};
	});
});

describe("#1563 the template pass respects inline script fences", () => {
	it("does not expand a {{TEMPLATE:}} written inside a script's source", async () => {
		// The run consumes the fence FIRST (replaceInlineJavascriptInString is its
		// first pass), so this token is never an include there. The preview has no
		// inline-JS pass at all, so without the span guard it would read N.md,
		// splice the body into the middle of the source, and report a bogus
		// "Template not found" for a format that is fine.
		templates["N.md"] = "SPLICED";
		const fence = 'a\n```js quickadd\nconst p = "{{TEMPLATE:Gone.md}}";\n```\nb';
		const f = makeFormatter();

		const out = await f.format(fence);

		expect(out).toContain('"{{TEMPLATE:Gone.md}}"');
		expect(out).not.toContain("template not found");
		expect(f.diagnostics.list()).toEqual([]);
	});

	it("still expands an include that sits outside the fence", async () => {
		templates["N.md"] = "SPLICED";
		const f = makeFormatter();

		const out = await f.format(
			'{{TEMPLATE:N.md}}\n```js quickadd\nconst p = "{{TEMPLATE:N.md}}";\n```',
		);

		expect(out.startsWith("SPLICED")).toBe(true);
		expect(out).toContain('"{{TEMPLATE:N.md}}"');
	});
});
