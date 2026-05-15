import { beforeEach, describe, expect, it, vi } from "vitest";

const { genericSuggestMock, inputSuggestMock } = vi.hoisted(() => ({
	genericSuggestMock: vi.fn(),
	inputSuggestMock: vi.fn(),
}));

vi.mock("../gui/GenericSuggester/genericSuggester", () => ({
	default: {
		Suggest: genericSuggestMock,
	},
}));

vi.mock("../gui/InputSuggester/inputSuggester", () => ({
	default: {
		Suggest: inputSuggestMock,
	},
}));

import type { App } from "obsidian";
import { Notice } from "obsidian";
import { MacroAbortError } from "../errors/MacroAbortError";
import { FolderSelectionService } from "./FolderSelectionService";

type NoticeTestClass = typeof Notice & {
	instances: Array<{ message: string; timeout?: number }>;
};

const noticeClass = Notice as unknown as NoticeTestClass;

function createApp(existingPaths = new Set<string>()) {
	const createFolder = vi.fn(async (path: string) => {
		existingPaths.add(path);
	});
	const exists = vi.fn(async (path: string) => existingPaths.has(path));

	const app = {
		vault: {
			adapter: { exists },
			createFolder,
		},
	} as unknown as App;

	return { app, createFolder, exists };
}

describe("FolderSelectionService", () => {
	beforeEach(() => {
		genericSuggestMock.mockReset();
		inputSuggestMock.mockReset();
		noticeClass.instances.length = 0;
	});

	it("returns an existing valid single folder without prompting or recreating it", async () => {
		const { app, createFolder } = createApp(new Set(["Projects"]));
		const service = new FolderSelectionService(app);

		await expect(service.getOrCreateFolder(["Projects"])).resolves.toBe(
			"Projects",
		);

		expect(genericSuggestMock).not.toHaveBeenCalled();
		expect(inputSuggestMock).not.toHaveBeenCalled();
		expect(createFolder).not.toHaveBeenCalled();
	});

	it("throws when a non-prompted single selection is outside allowed roots", async () => {
		const { app, createFolder } = createApp(new Set(["Archive"]));
		const service = new FolderSelectionService(app);

		await expect(
			service.getOrCreateFolder(["Archive"], {
				allowedRoots: ["Projects"],
			}),
		).rejects.toThrow(new MacroAbortError("Selected folder not allowed."));

		expect(createFolder).not.toHaveBeenCalled();
		expect(noticeClass.instances.map((notice) => notice.message)).toEqual([
			"Folder must be under: Projects",
		]);
	});

	it("rejects invalid non-prompted single selections before returning or creating", async () => {
		const invalidFolders = [
			"Projects/TrailingSpace ",
			"Projects/TrailingPeriod.",
			"Projects/CON",
			"Projects/..",
			"Projects/Bad\u0001Name",
			'Projects/Bad"Name',
		];

		for (const folder of invalidFolders) {
			noticeClass.instances.length = 0;
			const { app, createFolder } = createApp();
			const service = new FolderSelectionService(app);

			await expect(
				service.getOrCreateFolder([folder], {
					allowedRoots: ["Projects"],
				}),
			).resolves.toBe("");

			expect(createFolder).not.toHaveBeenCalled();
			expect(noticeClass.instances).toHaveLength(1);
		}
	});

	it("notices and reprompts invalid typed folders before creating a valid one", async () => {
		const { app, createFolder } = createApp(new Set(["Projects"]));
		const service = new FolderSelectionService(app);

		inputSuggestMock
			.mockResolvedValueOnce("Projects/Invalid ")
			.mockResolvedValueOnce("Projects/Valid");

		await expect(
			service.getOrCreateFolder([], {
				allowCreate: true,
				allowedRoots: ["Projects"],
			}),
		).resolves.toBe("Projects/Valid");

		expect(inputSuggestMock).toHaveBeenCalledTimes(2);
		expect(createFolder).toHaveBeenCalledTimes(1);
		expect(createFolder).toHaveBeenCalledWith("Projects/Valid");
		expect(noticeClass.instances.map((notice) => notice.message)).toEqual([
			"Folder name cannot end with a space or a period.",
		]);
	});

	it("notices and reprompts typed folders outside allowed roots", async () => {
		const { app, createFolder } = createApp(new Set(["Projects"]));
		const service = new FolderSelectionService(app);

		inputSuggestMock
			.mockResolvedValueOnce("Archive/New")
			.mockResolvedValueOnce("Projects/New");

		await expect(
			service.getOrCreateFolder([], {
				allowCreate: true,
				allowedRoots: ["Projects"],
			}),
		).resolves.toBe("Projects/New");

		expect(inputSuggestMock).toHaveBeenCalledTimes(2);
		expect(createFolder).toHaveBeenCalledTimes(1);
		expect(createFolder).toHaveBeenCalledWith("Projects/New");
		expect(noticeClass.instances.map((notice) => notice.message)).toEqual([
			"Folder must be under: Projects",
		]);
	});
});
