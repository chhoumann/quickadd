import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
import type QuickAdd from "../main";
import type * as Obsidian from "obsidian";
import { CaptureChoice } from "../types/choices/CaptureChoice";
import { createChoiceExecutor } from "../../tests/helpers/createChoiceExecutor";
import { UserCancelError } from "../errors/UserCancelError";
import { CaptureChoiceEngine } from "./CaptureChoiceEngine";
import { readCaptureFrontmatter, serializeCaptureFrontmatter } from "./captureProperty";

const mocks = vi.hoisted(() => ({
	value: vi.fn<() => Promise<unknown>>(),
	template: vi.fn<() => Promise<string>>(),
	picker: vi.fn<() => Promise<string>>(),
	templaterEnabled: false,
	afterCreate: vi.fn<() => Promise<void>>(),
}));

vi.mock("obsidian", async (importOriginal) => ({
	...await importOriginal<typeof Obsidian>(),
	stringifyYaml: (value: Record<string, unknown>) => Object.entries(value).map(([key, item]) => `${key}: ${JSON.stringify(item)}\n`).join(""),
}));
vi.mock("../main", () => ({ default: class {} }));
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));
vi.mock("../logger/logManager", () => ({ log: { logError: vi.fn(), logWarning: vi.fn(), logMessage: vi.fn() } }));
vi.mock("src/gui/InputSuggester/inputSuggester", () => ({ default: { Suggest: mocks.picker } }));
vi.mock("../formatters/captureChoiceFormatter", () => ({
	CaptureChoiceFormatter: class {
		setPromptRunContext() {}
		setLinkToCurrentFileBehavior() {}
		setUseSelectionAsCaptureValue() {}
		setDestinationSourcePath() {}
		setDestinationFile() {}
		setTargetFolderPath() {}
		setTitle() {}
		consumeCreatedClipboardAttachmentPaths() { return []; }
		async formatFileName(value: string) { return value; }
		async formatPropertyName(value: string) { return value; }
		formatPropertyValue() { return mocks.value(); }
	},
}));
vi.mock("./SingleTemplateEngine", () => ({
	SingleTemplateEngine: class {
		setDestinationPath() {}
		setPromptRunContext() {}
		setLinkToCurrentFileBehavior() {}
		getAndClearTemplatePropertyVars() { return new Map(); }
		run() { return mocks.template(); }
	},
}));
vi.mock("../utilityObsidian", () => ({
	isFolder: () => false,
	openExistingFileTab: () => null,
	openFile: vi.fn(),
	overwriteTemplaterOnce: vi.fn(),
	isTemplaterTriggerOnCreateEnabled: () => mocks.templaterEnabled,
	waitForTemplaterTriggerOnCreateToComplete: mocks.afterCreate,
	withTemplaterFileCreationSuppressed: async (_app: unknown, _path: string, work: () => Promise<unknown>) => await work(),
}));

function fixture(content?: string) {
	const choice = new CaptureChoice("Set status");
	choice.captureTo = "Inbox.md";
	choice.propertyCapture = { property: { kind: "named", format: "status" }, action: "set", createIfMissing: true };
	const executor = { ...createChoiceExecutor(), interactive: false, recordExecutionResult: vi.fn(), signalAbort: vi.fn() };
	const file = Object.assign(new TFile(), { path: "Inbox.md", basename: "Inbox", name: "Inbox.md", extension: "md" });
	let stored = content;
	let beforeCallback: (() => void) | undefined;
	const create = vi.fn(async (_path: string, input: string) => { stored = input; return file; });
	const createFolder = vi.fn(async () => {});
	const processFrontMatter = vi.fn(async (_file: TFile, callback: (data: Record<string, unknown>) => void) => {
		beforeCallback?.();
		const current = readCaptureFrontmatter(stored ?? "");
		callback(current);
		stored = serializeCaptureFrontmatter(stored ?? "", current);
	});
	const app = {
		vault: {
			adapter: { exists: async (path: string) => path === "" || stored !== undefined },
			getAbstractFileByPath: (path: string) => path === file.path && stored !== undefined ? file : null,
			read: async () => stored ?? "",
			create, createFolder,
		},
		workspace: { getActiveFile: () => stored === undefined ? null : file, getActiveViewOfType: () => null },
		fileManager: { processFrontMatter },
	};
	const plugin = { settings: { useSelectionAsCaptureValue: false, showCaptureNotification: false } } as QuickAdd;
	return {
		choice, executor, file, create, createFolder, processFrontMatter,
		read: () => stored,
		overwrite: (content: string) => { stored = content; },
		race: (content: string) => { beforeCallback = () => { stored = content; }; },
		run: () => new CaptureChoiceEngine(app as unknown as App, plugin, choice, executor).run(),
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.value.mockResolvedValue("done");
	mocks.template.mockResolvedValue("---\nstatus: active\n---\nTemplate body\n");
	mocks.templaterEnabled = false;
	mocks.afterCreate.mockResolvedValue(undefined);
});

describe("Capture property writes", () => {
	it("writes a configured property while preserving unrelated properties and body", async () => {
		const test = fixture("---\nstatus: active\nother: 42\n---\nBody\n");
		test.choice.task = true;
		test.choice.insertAfter.enabled = true;
		test.choice.insertAfter.promptHeading = true;
		await test.run();
		expect(readCaptureFrontmatter(test.read() ?? "")).toEqual({ status: "done", other: 42 });
		expect(test.read()).toMatch(/---\nBody\n$/);
		expect(test.executor.recordExecutionResult).toHaveBeenCalledWith({ status: "success", file: test.file, effect: "changed" });
		expect(mocks.picker).not.toHaveBeenCalled();
	});

	it("uses the active Markdown file without requiring an editor insertion", async () => {
		const test = fixture("Body\n");
		test.choice.captureToActiveFile = true;
		await test.run();
		expect(readCaptureFrontmatter(test.read() ?? "")).toEqual({ status: "done" });
	});

	it("preserves the existing property's casing with creation disabled", async () => {
		const test = fixture("---\nStatus: active\n---\nBody\n");
		test.choice.propertyCapture!.createIfMissing = false;
		await test.run();
		expect(readCaptureFrontmatter(test.read() ?? "")).toEqual({ Status: "done" });
	});

	it("resolves property casing again against the callback's current values", async () => {
		const test = fixture("---\nstatus: active\n---\nBody\n");
		test.choice.propertyCapture!.createIfMissing = false;
		test.race("---\nSTATUS: active\n---\nBody\n");
		await test.run();
		expect(readCaptureFrontmatter(test.read() ?? "")).toEqual({ STATUS: "done" });
	});

	it("adds to the callback's current list and keeps a concurrent unrelated edit", async () => {
		const test = fixture("---\nstatus: [old]\nother: before\n---\nBody\n");
		test.choice.propertyCapture!.action = "addToList";
		test.race("---\nstatus: [old, concurrent]\nother: after\n---\nNew body\n");
		await test.run();
		expect(readCaptureFrontmatter(test.read() ?? "")).toEqual({ status: ["old", "concurrent", "done"], other: "after" });
		expect(test.read()).toMatch(/---\nNew body\n$/);
	});

	it("validates again when the selected property's type changes during input", async () => {
		const test = fixture("---\nstatus: active\n---\nBody\n");
		test.race("---\nstatus: 7\n---\nConcurrent body\n");
		await test.run();
		expect(test.read()).toBe("---\nstatus: 7\n---\nConcurrent body\n");
		expect(test.executor.recordExecutionResult).toHaveBeenCalledWith(expect.objectContaining({ status: "error", reason: expect.stringContaining("requires number") }));
	});

	it("reports unchanged from persisted bytes after setting the same value", async () => {
		const test = fixture('---\nstatus: "done"\n---\nBody\n');
		await test.run();
		expect(test.executor.recordExecutionResult).toHaveBeenCalledWith(expect.objectContaining({ status: "success", effect: "unchanged" }));
	});

	it("does not create a target when value input is cancelled", async () => {
		const test = fixture();
		test.choice.createFileIfItDoesntExist.enabled = true;
		mocks.value.mockRejectedValue(new UserCancelError("Input cancelled by user"));
		await test.run();
		expect(test.create).not.toHaveBeenCalled();
		expect(test.createFolder).not.toHaveBeenCalled();
		expect(test.executor.signalAbort).toHaveBeenCalledWith(expect.any(UserCancelError));
	});

	it.each(["", []])("does not write or create a note for an empty list addition %j", async (value) => {
		for (const content of [undefined, "---\nstatus: [old]\n---\nBody\n"]) {
			const test = fixture(content);
			test.choice.createFileIfItDoesntExist.enabled = true;
			test.choice.propertyCapture!.action = "addToList";
			mocks.value.mockResolvedValue(value);
			await test.run();
			expect(test.read()).toBe(content);
			expect(test.create).not.toHaveBeenCalled();
			expect(test.processFrontMatter).not.toHaveBeenCalled();
			expect(test.executor.recordExecutionResult).toHaveBeenCalledWith({ status: "success", file: content === undefined ? undefined : test.file, effect: "unchanged" });
		}
	});

	it("still rejects an empty Add against a scalar property", async () => {
		const test = fixture("---\nstatus: active\n---\nBody\n");
		test.choice.propertyCapture!.action = "addToList";
		mocks.value.mockResolvedValue("");
		await test.run();
		expect(test.processFrontMatter).not.toHaveBeenCalled();
		expect(test.executor.recordExecutionResult).toHaveBeenCalledWith(expect.objectContaining({ status: "error", reason: expect.stringContaining("requires a list") }));
	});

	it("validates against a prepared template before creating once", async () => {
		const test = fixture();
		test.choice.createFileIfItDoesntExist = { enabled: true, createWithTemplate: true, template: "Template.md" };
		await test.run();
		expect(test.create).toHaveBeenCalledTimes(1);
		expect(test.processFrontMatter).toHaveBeenCalledTimes(1);
		expect(readCaptureFrontmatter(test.read() ?? "")).toEqual({ status: "done" });
		expect(test.read()).toMatch(/---\nTemplate body\n$/);
	});

	it("rejects a type mismatch with the template before creating a note", async () => {
		const test = fixture();
		test.choice.createFileIfItDoesntExist = { enabled: true, createWithTemplate: true, template: "Template.md" };
		mocks.template.mockResolvedValue("---\nstatus: 7\n---\nBody");
		await test.run();
		expect(test.create).not.toHaveBeenCalled();
		expect(test.createFolder).not.toHaveBeenCalled();
	});

	it("applies the prepared value after a create-time Templater trigger", async () => {
		const test = fixture();
		test.choice.createFileIfItDoesntExist.enabled = true;
		mocks.templaterEnabled = true;
		mocks.afterCreate.mockImplementation(async () => { test.overwrite("---\nstatus: trigger\n---\nTemplater body\n"); });
		await test.run();
		expect(readCaptureFrontmatter(test.read() ?? "")).toEqual({ status: "done" });
		expect(test.read()).toMatch(/---\nTemplater body\n$/);
		expect(test.create).toHaveBeenCalledTimes(1);
	});

	it("aborts a headless runtime property picker before target creation", async () => {
		const test = fixture();
		test.choice.createFileIfItDoesntExist.enabled = true;
		test.choice.propertyCapture!.property = { kind: "prompt" };
		await test.run();
		expect(test.create).not.toHaveBeenCalled();
		expect(mocks.value).not.toHaveBeenCalled();
		expect(test.executor.signalAbort).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("Configure a named property") }));
	});

	it("routes runtime property selection through the connected prompt provider", async () => {
		const test = fixture("---\nstatus: active\n---\nBody\n");
		test.choice.propertyCapture!.property = { kind: "prompt" };
		test.executor.interactive = true;
		Object.assign(test.executor, { promptProvider: { suggester: vi.fn(async (_labels: string[], handles: string[]) => handles[0]) } });
		await test.run();
		expect(readCaptureFrontmatter(test.read() ?? "")).toEqual({ status: "done" });
		expect(mocks.picker).not.toHaveBeenCalled();
	});
});
