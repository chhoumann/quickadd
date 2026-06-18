import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";

vi.mock("obsidian", () => ({
	MarkdownView: class {},
	normalizePath: (path: string) => path.replace(/\\/g, "/").replace(/\/+/g, "/"),
}));

vi.mock("../utilityObsidian", () => ({
	templaterParseTemplate: vi.fn().mockResolvedValue(null),
}));

vi.mock("../gui/InputPrompt", () => ({
	__esModule: true,
	default: class {
		factory() {
			return {
				Prompt: vi.fn().mockResolvedValue(""),
				PromptWithContext: vi.fn().mockResolvedValue(""),
			};
		}
	},
}));

vi.mock("src/gui/GenericInputPrompt/GenericInputPrompt", () => ({
	__esModule: true,
	default: { PromptWithContext: vi.fn().mockResolvedValue("") },
}));

vi.mock("src/gui/InputSuggester/inputSuggester", () => ({
	__esModule: true,
	default: { Suggest: vi.fn().mockResolvedValue("") },
}));

vi.mock("src/gui/MultiSuggester/multiSuggester", () => ({
	__esModule: true,
	default: { Suggest: vi.fn().mockResolvedValue([]) },
}));

vi.mock("src/gui/VDateInputPrompt/VDateInputPrompt", () => ({
	__esModule: true,
	default: { Prompt: vi.fn().mockResolvedValue("") },
}));

vi.mock("../gui/GenericSuggester/genericSuggester", () => ({
	__esModule: true,
	default: { Suggest: vi.fn().mockResolvedValue("") },
}));

vi.mock("../gui/MathModal", () => ({
	__esModule: true,
	MathModal: { Prompt: vi.fn().mockResolvedValue("") },
}));

vi.mock("../engine/SingleInlineScriptEngine", () => ({
	__esModule: true,
	SingleInlineScriptEngine: class {
		public params = { variables: {} as Record<string, unknown> };
		async runAndGetOutput() {
			return "";
		}
	},
}));

vi.mock("../engine/SingleMacroEngine", () => ({
	__esModule: true,
	SingleMacroEngine: class {
		async runAndGetOutput() {
			return "";
		}
		getVariables() {
			return new Map();
		}
	},
}));

vi.mock("../engine/SingleTemplateEngine", () => ({
	__esModule: true,
	SingleTemplateEngine: class {
		async run() {
			return "";
		}
		getAndClearTemplatePropertyVars() {
			return new Map();
		}
		setLinkToCurrentFileBehavior() {}
		setTargetFolderPath() {}
	},
}));

vi.mock("obsidian-dataview", () => ({
	__esModule: true,
	getAPI: vi.fn().mockReturnValue(null),
}));

vi.mock("../logger/logManager", () => ({
	log: {
		logError: vi.fn(),
		logWarning: vi.fn(),
		logMessage: vi.fn(),
	},
}));

import { CaptureChoiceFormatter } from "./captureChoiceFormatter";

function createTFile(path: string): TFile {
	const name = path.split("/").pop() ?? path;
	return {
		path,
		name,
		basename: name.replace(/\.[^.]+$/, ""),
		extension: name.includes(".") ? name.split(".").pop() : "",
	} as unknown as TFile;
}

function createMockApp() {
	const createBinary = vi.fn(async (path: string) => createTFile(path));
	const getAvailablePathForAttachment = vi.fn(async () => "Assets/clip.png");
	const generateMarkdownLink = vi.fn((file: TFile) => `[[${file.path}]]`);
	const app = {
		workspace: {
			getActiveFile: vi.fn().mockReturnValue(null),
			getActiveViewOfType: vi.fn().mockReturnValue(null),
		},
		metadataCache: { getFileCache: vi.fn().mockReturnValue(null) },
		fileManager: {
			generateMarkdownLink,
			getAvailablePathForAttachment,
			processFrontMatter: vi.fn(),
		},
		vault: {
			adapter: { exists: vi.fn() },
			cachedRead: vi.fn(),
			createBinary,
		},
	} as unknown as App;

	return {
		app,
		createBinary,
		generateMarkdownLink,
		getAvailablePathForAttachment,
	};
}

function createFormatter(app: App) {
	const plugin = {
		settings: {
			enableTemplatePropertyTypes: false,
			globalVariables: {},
			inputPrompt: "single-line",
			showCaptureNotification: false,
		},
	};
	return new CaptureChoiceFormatter(app, plugin as never);
}

function setClipboard({
	text = "",
	items = [],
	readRejects = false,
}: {
	text?: string;
	items?: ClipboardItem[];
	readRejects?: boolean;
}) {
	const readText = vi.fn().mockResolvedValue(text);
	const read = readRejects
		? vi.fn().mockRejectedValue(new Error("not focused"))
		: vi.fn().mockResolvedValue(items);
	Object.defineProperty(globalThis, "navigator", {
		value: { clipboard: { readText, read } },
		configurable: true,
	});
	return { read, readText };
}

function createClipboardItem(mimeType: string, bytes: number[]): ClipboardItem {
	const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
	return {
		types: [mimeType],
		getType: vi.fn().mockResolvedValue(blob),
	} as unknown as ClipboardItem;
}

describe("CaptureChoiceFormatter clipboard image support", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
		setClipboard({});
	});

	it("uses clipboard text before trying image attachment fallback", async () => {
		const { app, createBinary } = createMockApp();
		const item = createClipboardItem("image/png", [1, 2, 3]);
		const { read } = setClipboard({ text: "copied text", items: [item] });
		const formatter = createFormatter(app);
		formatter.setDestinationSourcePath("Notes/Clip.md");

		const result = await formatter.formatContentOnly("Copied: {{clipboard}}");

		expect(result).toBe("Copied: copied text");
		expect(read).not.toHaveBeenCalled();
		expect(createBinary).not.toHaveBeenCalled();
	});

	it("saves an image-only clipboard as one attachment and inserts an embed", async () => {
		vi.setSystemTime(new Date("2026-06-17T10:11:12Z"));
		const {
			app,
			createBinary,
			generateMarkdownLink,
			getAvailablePathForAttachment,
		} = createMockApp();
		const item = createClipboardItem("image/png", [1, 2, 3]);
		setClipboard({ items: [item] });
		const formatter = createFormatter(app);
		formatter.setDestinationSourcePath("Notes/Clip.md");

		const result = await formatter.formatContentOnly(
			"One {{clipboard}} Two {{clipboard}}",
		);

		expect(result).toBe("One ![[Assets/clip.png]] Two ![[Assets/clip.png]]");
		expect(getAvailablePathForAttachment).toHaveBeenCalledWith(
			expect.stringMatching(
				/^Clipboard image \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}\.png$/,
			),
			"Notes/Clip.md",
		);
		expect(createBinary).toHaveBeenCalledTimes(1);
		expect(createBinary).toHaveBeenCalledWith(
			"Assets/clip.png",
			expect.any(ArrayBuffer),
		);
		expect(generateMarkdownLink).toHaveBeenCalledWith(
			expect.objectContaining({ path: "Assets/clip.png" }),
			"Notes/Clip.md",
		);
	});

	it("inserts clipboard text literally when it contains the clipboard token", async () => {
		const { app } = createMockApp();
		setClipboard({ text: "{{clipboard}}" });
		const formatter = createFormatter(app);

		const result = await formatter.formatContentOnly("A {{clipboard}} B");

		expect(result).toBe("A {{clipboard}} B");
	});

	it("keeps image fallback disabled for file name formatting", async () => {
		const { app, createBinary } = createMockApp();
		const item = createClipboardItem("image/png", [1, 2, 3]);
		const { read } = setClipboard({ items: [item] });
		const formatter = createFormatter(app);
		formatter.setDestinationSourcePath("Notes/Clip.md");

		const result = await formatter.formatFileName("{{clipboard}}", "Capture");

		expect(result).toBe("");
		expect(read).not.toHaveBeenCalled();
		expect(createBinary).not.toHaveBeenCalled();
	});

	it("falls back to empty when image clipboard access is unavailable", async () => {
		const { app, createBinary } = createMockApp();
		const { read } = setClipboard({ readRejects: true });
		const formatter = createFormatter(app);
		formatter.setDestinationSourcePath("Notes/Clip.md");

		const result = await formatter.formatContentOnly("[{{clipboard}}]");

		expect(result).toBe("[]");
		expect(read).toHaveBeenCalledOnce();
		expect(createBinary).not.toHaveBeenCalled();
	});

	it("throws when an attachment write fails after finding an image", async () => {
		const { app, createBinary } = createMockApp();
		createBinary.mockRejectedValueOnce(new Error("write failed"));
		const item = createClipboardItem("image/png", [1, 2, 3]);
		setClipboard({ items: [item] });
		const formatter = createFormatter(app);
		formatter.setDestinationSourcePath("Notes/Clip.md");

		await expect(formatter.formatContentOnly("{{clipboard}}")).rejects.toThrow(
			"write failed",
		);
	});

	it("keeps a created attachment path available for rollback when link generation fails", async () => {
		const { app, generateMarkdownLink } = createMockApp();
		generateMarkdownLink.mockImplementationOnce(() => {
			throw new Error("link failed");
		});
		const item = createClipboardItem("image/png", [1, 2, 3]);
		setClipboard({ items: [item] });
		const formatter = createFormatter(app);
		formatter.setDestinationSourcePath("Notes/Clip.md");

		await expect(formatter.formatContentOnly("{{clipboard}}")).rejects.toThrow(
			"link failed",
		);
		expect(formatter.consumeCreatedClipboardAttachmentPaths()).toEqual([
			"Assets/clip.png",
		]);
	});
});
