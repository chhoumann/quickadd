import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Runtime prompt context (issue #1546): what the anonymous {{VALUE}} prompt
 * says about itself, and the invariants that keep it from saying something
 * false.
 */

const mocks = vi.hoisted(() => ({
	prompt: vi.fn(async () => "answer"),
	promptWithContext: vi.fn(async () => "answer"),
	suggest: vi.fn(async (..._args: unknown[]) => "true"),
	childScopes: [] as string[],
	childRunContexts: [] as unknown[],
}));

vi.mock("../engine/SingleTemplateEngine", () => ({
	SingleTemplateEngine: class {
		setTargetFolderPath() {}
		setPromptScope(scope: string) {
			mocks.childScopes.push(scope);
		}
		setPromptRunContext(context: unknown) {
			mocks.childRunContexts.push(context);
		}
		async run() {
			return "included";
		}
		getAndClearTemplatePropertyVars() {
			return new Map();
		}
	},
}));

vi.mock("obsidian", () => {
	class MarkdownView {}
	return { MarkdownView };
});

vi.mock("../gui/InputPrompt", () => ({
	default: class {
		factory() {
			return { Prompt: mocks.prompt, PromptWithContext: mocks.promptWithContext };
		}
	},
}));

vi.mock("../gui/GenericSuggester/genericSuggester", () => ({
	default: { Suggest: mocks.suggest },
}));

vi.mock("../gui/GenericInputPrompt/GenericInputPrompt", () => ({
	default: { Prompt: mocks.prompt, PromptWithContext: mocks.promptWithContext },
}));

vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn(() => null) }));
vi.mock("../gui/InputSuggester/inputSuggester", () => ({ default: {} }));
vi.mock("../gui/MultiSuggester/multiSuggester", () => ({ default: {} }));
vi.mock("../gui/VDateInputPrompt/VDateInputPrompt", () => ({ default: {} }));
vi.mock("../gui/MathModal", () => ({ MathModal: {} }));
vi.mock("../parsers/NLDParser", () => ({ NLDParser: { getNattyParser: () => ({}) } }));
vi.mock("../logger/logManager", () => ({
	log: { logMessage: vi.fn(), logWarning: vi.fn(), logError: vi.fn() },
}));

import { CompleteFormatter } from "./completeFormatter";

const app = {
	workspace: { getActiveFile: () => null, getActiveViewOfType: () => null },
	fileManager: { generateMarkdownLink: () => "" },
} as never;
const plugin = { settings: { globalVariables: {}, inputPrompt: "single-line" } } as never;

function makeFormatter() {
	return new CompleteFormatter(app, plugin);
}

/** The (app, header, placeholder, ...) tuple the modal factory was called with. */
function lastPromptCall() {
	const call =
		mocks.prompt.mock.calls.at(-1) ?? mocks.promptWithContext.mock.calls.at(-1);
	if (!call) throw new Error("no prompt was opened");
	const args = call as unknown as unknown[];
	return {
		header: args[1] as string,
		placeholder: args[2] as string | undefined,
		options: args.at(-1) as { contextLine?: string; draftScopeId?: string } | undefined,
	};
}

beforeEach(() => {
	// {{DATE}} only needs to resolve to *something* here; the tests assert on the
	// prompt copy, not on the date.
	(globalThis as unknown as { window: Record<string, unknown> }).window ??= {};
	(globalThis as unknown as { window: { moment: unknown } }).window.moment = () => ({
		add: () => ({ format: () => "2026-07-26" }),
		format: () => "2026-07-26",
		isValid: () => true,
	});
	mocks.prompt.mockClear();
	mocks.promptWithContext.mockClear();
	mocks.suggest.mockClear();
});

describe("anonymous {{VALUE}} prompt copy", () => {
	it("names the note title for a Template file-name pass", async () => {
		const f = makeFormatter();
		f.setPromptRunContext({ choiceName: "New template", draftScopeId: "tpl-1" });

		await f.formatFileName("{{VALUE}}", "noteTitle");

		expect(lastPromptCall()).toMatchObject({
			header: "Note title",
			placeholder: "Title for the new note",
		});
	});

	it("keeps the choice name when the answer is only part of the file name", async () => {
		const f = makeFormatter();
		f.setPromptRunContext({ choiceName: "Daily note" });

		// "Note title" here would invite the user to retype the date.
		await f.formatFileName("{{DATE:YYYY-MM-DD}} {{VALUE}}", "noteTitle");

		expect(lastPromptCall()).toMatchObject({
			header: "Daily note",
			placeholder: "Part of the new note's title",
		});
	});

	it("still names the capture text when the format only adds decoration", async () => {
		const f = makeFormatter();
		f.setPromptRunContext({ choiceName: "Quick note" });

		await f.withPromptScope("captureText", "- [ ] {{VALUE}}\n", () =>
			f.formatFileContent("- [ ] {{VALUE}}\n"),
		);

		expect(lastPromptCall()).toMatchObject({
			header: "Text to capture",
			placeholder: "Text to add to the note",
		});
	});

	it("falls back to 'Enter value' with no run context (script API, AI agent)", async () => {
		const f = makeFormatter();

		await f.formatFileContent("{{VALUE}}");

		expect(lastPromptCall()).toMatchObject({ header: "Enter value" });
	});
});

describe("prompt context line", () => {
	it("carries the choice name and the resolved destination", async () => {
		const f = makeFormatter();
		f.setPromptRunContext({
			choiceName: "New capture",
			destination: "Daily/2026-07-26.md",
			destinationKind: "file",
		});

		await f.withPromptScope("captureText", "{{VALUE}}", () =>
			f.formatFileContent("{{VALUE}}"),
		);

		expect(lastPromptCall().options?.contextLine).toBe(
			"New capture → Daily/2026-07-26.md",
		);
	});

	it("reaches a plain prompt that has no other options set", async () => {
		// buildInputPromptOptions used to early-return undefined for exactly this
		// prompt, which would have swallowed both the context line and scope id.
		const f = makeFormatter();
		f.setPromptRunContext({ choiceName: "New capture", draftScopeId: "cap-1" });

		await f.formatFileContent("{{VALUE}}");

		expect(lastPromptCall().options).toMatchObject({ draftScopeId: "cap-1" });
	});
});

describe("scope isolation", () => {
	it("does not let a path pass retitle a later content prompt", async () => {
		// The old sticky `valueHeader` was set by formatFileName and never reset,
		// so a Capture's body prompt inherited the target pass's title.
		const f = makeFormatter();
		f.setPromptRunContext({ choiceName: "New capture" });

		await f.formatFileName("Daily/{{DATE:YYYY-MM-DD}}.md", "captureTarget");
		await f.withPromptScope("captureText", "{{VALUE}}", () =>
			f.formatFileContent("{{VALUE}}"),
		);

		expect(lastPromptCall().header).toBe("Text to capture");
	});

	it("restores the previous scope when a pass throws", async () => {
		const f = makeFormatter();
		f.setPromptRunContext({ choiceName: "New template" });

		await expect(
			f.withPromptScope("noteTitle", "{{VALUE}}", async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");

		await f.formatFileContent("{{VALUE}}");

		expect(lastPromptCall().header).toBe("New template");
	});
});

describe("template source paths", () => {
	it("does not claim the destination for a prompt that only picks a template", async () => {
		const f = makeFormatter();
		f.setPromptRunContext({
			choiceName: "Book note",
			destination: "Inbox/Draft.md",
			destinationKind: "file",
		});

		// The answer chooses WHICH template file to read; it never lands in the
		// note being written, so the line names the choice and stops there.
		await f.formatTemplateFilePath("Templates/{{VALUE:kind}}.md");

		expect(lastPromptCall()).toMatchObject({ header: "kind" });
		expect(lastPromptCall().options?.contextLine).toBe("Book note");
	});
});

describe("included templates", () => {
	it("inherits the including pass's scope instead of claiming note content", async () => {
		// `{{TEMPLATE:x}}` inside a FILE NAME is part of that file name; the child
		// engine renders it through its own formatter, so the scope has to travel.
		const f = makeFormatter();
		f.setPromptRunContext({ choiceName: "My template", draftScopeId: "tpl" });
		mocks.childScopes.length = 0;
		mocks.childRunContexts.length = 0;

		await f.formatFileName("{{TEMPLATE:Templates/Name.md}}", "noteTitle");

		expect(mocks.childScopes).toEqual(["noteTitle"]);
		// A separate draft scope, so the include's own prompt cannot open
		// pre-filled with the parent's answer.
		expect(mocks.childRunContexts.at(-1)).toMatchObject({
			choiceName: "My template",
			draftScopeId: "tpl#Templates/Name.md",
		});
	});
});

describe("forced true/false picker", () => {
	it("keeps the choice name rather than degrading to 'Choose value'", async () => {
		const f = makeFormatter();
		f.setPromptRunContext({ choiceName: "Task" });

		await f.formatFileContent("done: {{VALUE|type:checkbox}}");

		expect(mocks.suggest.mock.calls.at(-1)?.[3]).toBe("Task");
	});
});
