import { describe, expect, it, vi } from "vitest";
import { ChoiceAbortError } from "../errors/ChoiceAbortError";

/**
 * Issue #1591. `createFileWithTemplate` reads the template, formats the ENTIRE
 * body - real `{{VALUE}}` prompts, macros, and inline `js quickadd` fences with
 * their side effects - and only then hands the path to `createFileWithInput`,
 * which creates the target FOLDER before `vault.create` refuses the name.
 *
 * Measured on Obsidian 1.13.0 (isolated e2e vault) before the fix: a Template
 * choice named `Bad: {{VALUE:title}}` reported "no file was created" AND left
 * `Repro1591Folder` behind AND had run the template's inline script once.
 *
 * The guard is the first statement of `createFileWithTemplate`, so this asserts
 * on the observable consequence: nothing downstream of it is reached.
 */

vi.mock("obsidian", async () => {
	const actual = await import("../../tests/obsidian-stub");
	return actual;
});
vi.mock("../formatters/completeFormatter", () => ({
	CompleteFormatter: class {
		setTitle() {}
		setTargetFolderPath() {}
		setPromptRunContext() {}
		setTemplateInclusionState() {}
	},
}));
vi.mock("../utilityObsidian", () => ({
	getTemplateFile: vi.fn(),
	getTemplater: vi.fn(() => null),
	overwriteTemplaterOnce: vi.fn(),
	templaterParseTemplate: vi.fn(),
}));
vi.mock("../logger/logManager", () => ({
	log: { logWarning: vi.fn(), logError: vi.fn(), logMessage: vi.fn() },
}));

const { TemplateEngine } = await import("./TemplateEngine");

class ProbeEngine extends (TemplateEngine as never as new (
	...args: never[]
) => Record<string, unknown>) {
	public readTemplate = vi.fn();
	public created = vi.fn();

	constructor() {
		super(
			{ vault: {}, workspace: {} } as never,
			{ settings: {} } as never,
		);
	}

	run() {
		return Promise.resolve();
	}

	// Everything the guard must run BEFORE.
	protected getTemplateContent(path: string) {
		this.readTemplate(path);
		return Promise.resolve("body");
	}
	protected createFileWithInput(path: string) {
		this.created(path);
		return Promise.resolve({ path });
	}
}

function makeEngine() {
	return new ProbeEngine() as unknown as ProbeEngine & {
		createFileWithTemplate: (
			filePath: string,
			templatePath: string,
		) => Promise<unknown>;
	};
}

describe("createFileWithTemplate refuses an impossible name first (#1591)", () => {
	it("aborts without reading the template or creating anything", async () => {
		const engine = makeEngine();

		await expect(
			engine.createFileWithTemplate("Notes/Bad: My Note.md", "T.md"),
		).rejects.toBeInstanceOf(ChoiceAbortError);

		expect(engine.readTemplate).not.toHaveBeenCalled();
		expect(engine.created).not.toHaveBeenCalled();
	});

	it("aborts for a colon in a FOLDER segment, before the folder is created", async () => {
		const engine = makeEngine();

		await expect(
			engine.createFileWithTemplate("Meetings: 2026/Note.md", "T.md"),
		).rejects.toBeInstanceOf(ChoiceAbortError);

		expect(engine.readTemplate).not.toHaveBeenCalled();
	});

	it("leaves a legal path alone", async () => {
		// Getting as far as reading the template is what proves the guard let it
		// through; the rest of the create path needs the real formatter and is
		// covered by TemplateChoiceEngine's own suites.
		const engine = makeEngine();

		await engine.createFileWithTemplate("Notes/My Note.md", "T.md");

		expect(engine.readTemplate).toHaveBeenCalledWith("T.md");
	});
});
