import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";

vi.mock("../gui/choiceList/ChoiceView.svelte", () => ({}));
vi.mock("../gui/GlobalVariables/GlobalVariablesView.svelte", () => ({}));
vi.mock("../main", () => ({
	__esModule: true,
	default: class QuickAddMock {},
}));
vi.mock("obsidian-dataview", () => ({
	getAPI: vi.fn(),
}));

import { CompleteFormatter } from "./completeFormatter";

const createMockApp = () => {
	const attachmentFile = {
		path: "Assets/pasted-image.png",
		name: "pasted-image.png",
		basename: "pasted-image",
		extension: "png",
	} as unknown as TFile;

	return {
		attachmentFile,
		app: {
			workspace: {
				getActiveFile: vi.fn().mockReturnValue(null),
				getActiveViewOfType: vi.fn().mockReturnValue(null),
			},
			fileManager: {
				generateMarkdownLink: vi.fn().mockReturnValue("[[Assets/pasted-image.png]]"),
				getAvailablePathForAttachment: vi
					.fn()
					.mockResolvedValue("Assets/pasted-image.png"),
			},
			vault: {
				createBinary: vi.fn().mockResolvedValue(attachmentFile),
			},
		} as unknown as App,
	};
};

const createPlugin = () =>
	({
		settings: {
			inputPrompt: "single-line",
			enableTemplatePropertyTypes: false,
			globalVariables: {},
		},
	}) as any;

const setClipboard = (clipboard: Record<string, unknown>) => {
	Object.defineProperty(globalThis, "navigator", {
		value: { clipboard },
		configurable: true,
		writable: true,
	});
};

const setWindowRequire = (requireImpl?: (id: string) => unknown) => {
	Object.defineProperty(window, "require", {
		value: requireImpl,
		configurable: true,
		writable: true,
	});
};

describe("CompleteFormatter clipboard handling", () => {
	beforeEach(() => {
		vi.useRealTimers();
		setWindowRequire(undefined);
		setClipboard({
			readText: vi.fn().mockResolvedValue("clipboard text"),
		});
	});

	it("uses plain text clipboard content for note formatting when no image is present", async () => {
		const { app } = createMockApp();
		const formatter = new CompleteFormatter(app, createPlugin());
		formatter.setDestinationSourcePath("Notes/Daily.md");

		const result = await formatter.formatFileContent("{{clipboard}}");

		expect(result).toBe("clipboard text");
		expect(app.vault.createBinary).not.toHaveBeenCalled();
	});

	it("does not resolve clipboard content when the token is absent", async () => {
		const { app } = createMockApp();
		const formatter = new CompleteFormatter(app, createPlugin());
		formatter.setDestinationSourcePath("Notes/Daily.md");

		const readText = vi.fn().mockResolvedValue("clipboard text");
		const read = vi.fn().mockResolvedValue([
			{
				types: ["image/png"],
				getType: vi.fn().mockResolvedValue(
					new Blob(["image-bytes"], { type: "image/png" }),
				),
			},
		]);
		setClipboard({
			read,
			readText,
		});

		const result = await formatter.formatFileContent("No clipboard token here");

		expect(result).toBe("No clipboard token here");
		expect(read).not.toHaveBeenCalled();
		expect(readText).not.toHaveBeenCalled();
		expect(app.vault.createBinary).not.toHaveBeenCalled();
	});

	it("saves a clipboard image attachment and returns an Obsidian embed", async () => {
		const { app } = createMockApp();
		const formatter = new CompleteFormatter(app, createPlugin());
		formatter.setDestinationSourcePath("Notes/Daily.md");

		const imageBlob = new Blob(["image-bytes"], { type: "image/png" });
		const read = vi.fn().mockResolvedValue([
			{
				types: ["image/png"],
				getType: vi.fn().mockResolvedValue(imageBlob),
			},
		]);
		setClipboard({
			read,
			readText: vi.fn().mockResolvedValue("clipboard text"),
		});

		const result = await formatter.formatFileContent("{{clipboard}}");

		expect(read).toHaveBeenCalledOnce();
		expect(result).toBe("![[Assets/pasted-image.png]]");
		expect(app.fileManager.getAvailablePathForAttachment).toHaveBeenCalledWith(
			expect.stringMatching(/^Pasted image \d{8}-\d{6}\.png$/),
			"Notes/Daily.md",
		);
		expect(app.vault.createBinary).toHaveBeenCalledWith(
			"Assets/pasted-image.png",
			expect.any(ArrayBuffer),
		);
		expect(app.fileManager.generateMarkdownLink).toHaveBeenCalledWith(
			expect.objectContaining({ path: "Assets/pasted-image.png" }),
			"Notes/Daily.md",
		);
	});

	it("falls back to clipboard text when image inspection fails", async () => {
		const { app } = createMockApp();
		const formatter = new CompleteFormatter(app, createPlugin());
		formatter.setDestinationSourcePath("Notes/Daily.md");

		setClipboard({
			read: vi.fn().mockRejectedValue(new Error("denied")),
			readText: vi.fn().mockResolvedValue("clipboard text"),
		});

		const result = await formatter.formatFileContent("{{clipboard}}");

		expect(result).toBe("clipboard text");
		expect(app.vault.createBinary).not.toHaveBeenCalled();
	});

	it("falls back to plain text when no destination note context exists", async () => {
		const { app } = createMockApp();
		const formatter = new CompleteFormatter(app, createPlugin());

		setClipboard({
			read: vi.fn().mockResolvedValue([
				{
					types: ["image/png"],
					getType: vi.fn().mockResolvedValue(
						new Blob(["image-bytes"], { type: "image/png" }),
					),
				},
			]),
			readText: vi.fn().mockResolvedValue("clipboard text"),
		});

		const result = await formatter.formatFileContent("{{clipboard}}");

		expect(result).toBe("clipboard text");
		expect(app.vault.createBinary).not.toHaveBeenCalled();
	});

	it("imports a local clipboard image path as an attachment embed", async () => {
		const { app } = createMockApp();
		const formatter = new CompleteFormatter(app, createPlugin());
		formatter.setDestinationSourcePath("Notes/Daily.md");

		const readFile = vi
			.fn()
			.mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
		const existsSync = vi.fn().mockReturnValue(true);
		setClipboard({
			read: vi.fn().mockResolvedValue([]),
			readText: vi
				.fn()
				.mockResolvedValue("/Users/christian/Library/Caches/Clop/images/85074.png"),
		});
		setWindowRequire((id: string) => {
			if (id === "fs") {
				return {
					existsSync,
					promises: { readFile },
				};
			}
			return undefined;
		});

		const result = await formatter.formatFileContent("{{clipboard}}");

		expect(result).toBe("![[Assets/pasted-image.png]]");
		expect(existsSync).toHaveBeenCalledWith(
			"/Users/christian/Library/Caches/Clop/images/85074.png",
		);
		expect(readFile).toHaveBeenCalledWith(
			"/Users/christian/Library/Caches/Clop/images/85074.png",
		);
		expect(app.fileManager.getAvailablePathForAttachment).toHaveBeenCalledWith(
			expect.stringMatching(/^Pasted image \d{8}-\d{6}\.png$/),
			"Notes/Daily.md",
		);
		expect(app.vault.createBinary).toHaveBeenCalledWith(
			"Assets/pasted-image.png",
			expect.any(ArrayBuffer),
		);
	});

	it("imports a local .jpeg clipboard image path as an attachment embed", async () => {
		const { app } = createMockApp();
		const formatter = new CompleteFormatter(app, createPlugin());
		formatter.setDestinationSourcePath("Notes/Daily.md");

		const readFile = vi
			.fn()
			.mockResolvedValue(new Uint8Array([255, 216, 255, 224]));
		setClipboard({
			read: vi.fn().mockResolvedValue([]),
			readText: vi
				.fn()
				.mockResolvedValue("/Users/christian/Library/Caches/Clop/images/85074.jpeg"),
		});
		setWindowRequire((id: string) => {
			if (id === "fs") {
				return {
					existsSync: vi.fn().mockReturnValue(true),
					promises: { readFile },
				};
			}
			return undefined;
		});

		const result = await formatter.formatFileContent("{{clipboard}}");

		expect(result).toBe("![[Assets/pasted-image.png]]");
		expect(app.fileManager.getAvailablePathForAttachment).toHaveBeenCalledWith(
			expect.stringMatching(/^Pasted image \d{8}-\d{6}\.jpeg$/),
			"Notes/Daily.md",
		);
		expect(readFile).toHaveBeenCalledWith(
			"/Users/christian/Library/Caches/Clop/images/85074.jpeg",
		);
	});

	it("reuses the same resolved clipboard embed across repeated content passes", async () => {
		const { app } = createMockApp();
		const formatter = new CompleteFormatter(app, createPlugin());
		formatter.setDestinationSourcePath("Notes/Daily.md");

		const readFile = vi
			.fn()
			.mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
		setClipboard({
			read: vi.fn().mockResolvedValue([]),
			readText: vi
				.fn()
				.mockResolvedValue("/Users/christian/Library/Caches/Clop/images/85074.png"),
		});
		setWindowRequire((id: string) => {
			if (id === "fs") {
				return {
					existsSync: vi.fn().mockReturnValue(true),
					promises: { readFile },
				};
			}
			return undefined;
		});

		const first = await formatter.formatFileContent("{{clipboard}}");
		const second = await formatter.formatFileContent("{{clipboard}}");

		expect(first).toBe("![[Assets/pasted-image.png]]");
		expect(second).toBe("![[Assets/pasted-image.png]]");
		expect(readFile).toHaveBeenCalledOnce();
		expect(app.vault.createBinary).toHaveBeenCalledOnce();
	});

	it("leaves plain text untouched when clipboard path is not an existing image", async () => {
		const { app } = createMockApp();
		const formatter = new CompleteFormatter(app, createPlugin());
		formatter.setDestinationSourcePath("Notes/Daily.md");

		const existsSync = vi.fn().mockReturnValue(false);
		setClipboard({
			read: vi.fn().mockResolvedValue([]),
			readText: vi
				.fn()
				.mockResolvedValue("/Users/christian/Library/Caches/Clop/images/85074.png"),
		});
		setWindowRequire((id: string) => {
			if (id === "fs") {
				return {
					existsSync,
					promises: { readFile: vi.fn() },
				};
			}
			return undefined;
		});

		const result = await formatter.formatFileContent("{{clipboard}}");

		expect(result).toBe(
			"/Users/christian/Library/Caches/Clop/images/85074.png",
		);
		expect(app.vault.createBinary).not.toHaveBeenCalled();
	});

	it("keeps filename formatting text-only even when clipboard contains an image", async () => {
		const { app } = createMockApp();
		const formatter = new CompleteFormatter(app, createPlugin());
		formatter.setDestinationSourcePath("Notes/Daily.md");

		const read = vi.fn().mockResolvedValue([
			{
				types: ["image/png"],
				getType: vi.fn().mockResolvedValue(
					new Blob(["image-bytes"], { type: "image/png" }),
				),
			},
		]);
		const readText = vi.fn().mockResolvedValue("clipboard text");
		setClipboard({
			read,
			readText,
		});

		const result = await formatter.formatFileName("{{clipboard}}", "Prompt");

		expect(result).toBe("clipboard text");
		expect(read).not.toHaveBeenCalled();
		expect(readText).toHaveBeenCalledOnce();
		expect(app.vault.createBinary).not.toHaveBeenCalled();
	});
});
