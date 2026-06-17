import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";

vi.mock("../utilityObsidian", () => ({
	templaterParseTemplate: vi.fn().mockResolvedValue(null),
}));

vi.mock("../gui/InputPrompt", () => ({
	__esModule: true,
	default: class {
		factory() {
			return { Prompt: vi.fn().mockResolvedValue("") };
		}
	},
}));

vi.mock("../gui/InputSuggester/inputSuggester", () => ({
	__esModule: true,
	default: class {},
}));

vi.mock("../gui/GenericSuggester/genericSuggester", () => ({
	__esModule: true,
	default: { Suggest: vi.fn().mockResolvedValue("") },
}));

vi.mock("../gui/VDateInputPrompt/VDateInputPrompt", () => ({
	__esModule: true,
	default: { Prompt: vi.fn().mockResolvedValue("") },
}));

vi.mock("../utils/errorUtils", () => ({
	__esModule: true,
	reportError: vi.fn(),
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
	},
}));

vi.mock("obsidian-dataview", () => ({
	__esModule: true,
	getAPI: vi.fn().mockReturnValue(null),
}));

import { CaptureChoiceFormatter } from "./captureChoiceFormatter";

const createTFile = (path: string): TFile => {
	const name = path.split("/").pop() ?? path;
	return {
		path,
		name,
		basename: name.replace(/\.[^.]+$/, ""),
		extension: name.includes(".") ? name.split(".").pop() : "",
	} as unknown as TFile;
};

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

	return { app, createBinary, getAvailablePathForAttachment, generateMarkdownLink };
}

function createFormatter(app: App) {
	const plugin = {
		settings: {
			enableTemplatePropertyTypes: false,
			globalVariables: {},
			showCaptureNotification: false,
		},
	};
	return new CaptureChoiceFormatter(app, plugin as never);
}

describe("CaptureChoiceFormatter clipboard image support", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
		(globalThis as typeof globalThis & { navigator: Navigator }).navigator = {
			clipboard: {
				readText: vi.fn().mockResolvedValue(""),
			},
		} as unknown as Navigator;
	});

	it("keeps text clipboard behavior ahead of image attachment fallback", async () => {
		const { app, createBinary } = createMockApp();
		const read = vi.fn().mockResolvedValue([
			{
				types: ["image/png"],
				getType: vi.fn(),
			},
		]);
		(globalThis.navigator.clipboard as Clipboard & { read: typeof read }).read =
			read;
		vi.mocked(globalThis.navigator.clipboard.readText).mockResolvedValue(
			"copied text",
		);
		const formatter = createFormatter(app);
		formatter.setDestinationSourcePath("Notes/Clip.md");

		const result = await formatter.formatContentOnly("Copied: {{clipboard}}");

		expect(result).toBe("Copied: copied text");
		expect(read).not.toHaveBeenCalled();
		expect(createBinary).not.toHaveBeenCalled();
	});

	it("saves an image-only clipboard as one attachment and inserts an embed", async () => {
		vi.setSystemTime(new Date("2026-06-17T10:11:12Z"));
		const { app, createBinary, generateMarkdownLink, getAvailablePathForAttachment } =
			createMockApp();
		const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
		(globalThis.navigator.clipboard as Clipboard & {
			read: () => Promise<ClipboardItem[]>;
		}).read = vi.fn().mockResolvedValue([
			{
				types: ["image/png"],
				getType: vi.fn().mockResolvedValue(blob),
			},
		] as unknown as ClipboardItem[]);
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
		vi.mocked(globalThis.navigator.clipboard.readText).mockResolvedValue(
			"{{clipboard}}",
		);
		const formatter = createFormatter(app);

		const result = await formatter.formatContentOnly("A {{clipboard}} B");

		expect(result).toBe("A {{clipboard}} B");
	});

	it("falls back to empty when image clipboard read is unavailable", async () => {
		const { app, createBinary } = createMockApp();
		const formatter = createFormatter(app);

		const result = await formatter.formatContentOnly("[{{clipboard}}]");

		expect(result).toBe("[]");
		expect(createBinary).not.toHaveBeenCalled();
	});
});
