import { describe, it, expect } from "vitest";
import { FolderPathUpdater } from "./folderPathUpdater";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import type IChoice from "../types/choices/IChoice";

describe("FolderPathUpdater", () => {
	describe("updateChoicesFolderPaths", () => {
		it("should update captureTo in Capture choices", () => {
			const captureChoice: ICaptureChoice = {
				id: "test-capture",
				name: "Test Capture",
				type: "Capture",
				command: false,
				captureTo: "Daily Notes/test.md",
				captureToActiveFile: false,
				createFileIfItDoesntExist: { enabled: false, createWithTemplate: false, template: "" },
				format: { enabled: false, format: "" },
				prepend: false,
				appendLink: false,
				task: false,
				insertAfter: { enabled: false, after: "", insertAtEnd: false, considerSubsections: false, createIfNotFound: false, createIfNotFoundLocation: "" },
				newLineCapture: { enabled: false, direction: "below" },
				openFile: false,
				fileOpening: { location: "tab", direction: "vertical", mode: "default", focus: false }
			};

			const updated = FolderPathUpdater.updateChoicesFolderPaths(
				[captureChoice],
				"Daily Notes",
				"Journal"
			);

			expect(updated[0]).toEqual({
				...captureChoice,
				captureTo: "Journal/test.md"
			});
		});

		it("should update folder.folders in Template choices", () => {
			const templateChoice: ITemplateChoice = {
				id: "test-template",
				name: "Test Template",
				type: "Template",
				command: false,
				templatePath: "templates/note.md",
				folder: {
					enabled: true,
					folders: ["Daily Notes", "Projects/Active", "Archive"],
					chooseWhenCreatingNote: false,
					createInSameFolderAsActiveFile: false,
					chooseFromSubfolders: false
				},
				fileNameFormat: { enabled: false, format: "" },
				appendLink: false,
				openFile: false,
				fileOpening: { location: "tab", direction: "vertical", mode: "default", focus: false },
				fileExistsMode: "Increment the file name",
				setFileExistsBehavior: false
			};

			const updated = FolderPathUpdater.updateChoicesFolderPaths(
				[templateChoice],
				"Daily Notes",
				"Journal"
			);

			const updatedTemplate = updated[0] as ITemplateChoice;
			expect(updatedTemplate.folder.folders).toEqual(["Journal", "Projects/Active", "Archive"]);
		});

		it("should update nested choices in Multi choices", () => {
			const multiChoice: IMultiChoice = {
				id: "test-multi",
				name: "Test Multi",
				type: "Multi",
				command: false,
				collapsed: false,
				choices: [
					{
						id: "nested-capture",
						name: "Nested Capture",
						type: "Capture",
						command: false,
						captureTo: "Daily Notes/nested.md",
						captureToActiveFile: false,
						createFileIfItDoesntExist: { enabled: false, createWithTemplate: false, template: "" },
						format: { enabled: false, format: "" },
						prepend: false,
						appendLink: false,
						task: false,
						insertAfter: { enabled: false, after: "", insertAtEnd: false, considerSubsections: false, createIfNotFound: false, createIfNotFoundLocation: "" },
						newLineCapture: { enabled: false, direction: "below" },
						openFile: false,
						fileOpening: { location: "tab", direction: "vertical", mode: "default", focus: false }
					} as ICaptureChoice
				]
			};

			const updated = FolderPathUpdater.updateChoicesFolderPaths(
				[multiChoice],
				"Daily Notes",
				"Journal"
			);

			const updatedMulti = updated[0] as IMultiChoice;
			const nestedCapture = updatedMulti.choices[0] as ICaptureChoice;
			expect(nestedCapture.captureTo).toBe("Journal/nested.md");
		});

		it("should handle subfolder updates correctly", () => {
			const choice: ICaptureChoice = {
				id: "test",
				name: "Test",
				type: "Capture",
				command: false,
				captureTo: "Daily Notes/2023/December/test.md",
				captureToActiveFile: false,
				createFileIfItDoesntExist: { enabled: false, createWithTemplate: false, template: "" },
				format: { enabled: false, format: "" },
				prepend: false,
				appendLink: false,
				task: false,
				insertAfter: { enabled: false, after: "", insertAtEnd: false, considerSubsections: false, createIfNotFound: false, createIfNotFoundLocation: "" },
				newLineCapture: { enabled: false, direction: "below" },
				openFile: false,
				fileOpening: { location: "tab", direction: "vertical", mode: "default", focus: false }
			};

			const updated = FolderPathUpdater.updateChoicesFolderPaths(
				[choice],
				"Daily Notes",
				"Journal"
			);

			expect((updated[0] as ICaptureChoice).captureTo).toBe("Journal/2023/December/test.md");
		});

		it("should not update unrelated paths", () => {
			const choice: ICaptureChoice = {
				id: "test",
				name: "Test",
				type: "Capture",
				command: false,
				captureTo: "Projects/test.md",
				captureToActiveFile: false,
				createFileIfItDoesntExist: { enabled: false, createWithTemplate: false, template: "" },
				format: { enabled: false, format: "" },
				prepend: false,
				appendLink: false,
				task: false,
				insertAfter: { enabled: false, after: "", insertAtEnd: false, considerSubsections: false, createIfNotFound: false, createIfNotFoundLocation: "" },
				newLineCapture: { enabled: false, direction: "below" },
				openFile: false,
				fileOpening: { location: "tab", direction: "vertical", mode: "default", focus: false }
			};

			const updated = FolderPathUpdater.updateChoicesFolderPaths(
				[choice],
				"Daily Notes",
				"Journal"
			);

			expect((updated[0] as ICaptureChoice).captureTo).toBe("Projects/test.md");
		});

		it("should skip tag-based references", () => {
			const choice: ICaptureChoice = {
				id: "test",
				name: "Test",
				type: "Capture",
				command: false,
				captureTo: "#inbox",
				captureToActiveFile: false,
				createFileIfItDoesntExist: { enabled: false, createWithTemplate: false, template: "" },
				format: { enabled: false, format: "" },
				prepend: false,
				appendLink: false,
				task: false,
				insertAfter: { enabled: false, after: "", insertAtEnd: false, considerSubsections: false, createIfNotFound: false, createIfNotFoundLocation: "" },
				newLineCapture: { enabled: false, direction: "below" },
				openFile: false,
				fileOpening: { location: "tab", direction: "vertical", mode: "default", focus: false }
			};

			const updated = FolderPathUpdater.updateChoicesFolderPaths(
				[choice],
				"Daily Notes",
				"Journal"
			);

			expect((updated[0] as ICaptureChoice).captureTo).toBe("#inbox");
		});
	});

	describe("findChoicesWithFolderPath", () => {
		it("should find choices that reference a folder", () => {
			const choices: IChoice[] = [
				{
					id: "capture-1",
					name: "Capture 1",
					type: "Capture",
					command: false,
					captureTo: "Daily Notes/test.md",
					captureToActiveFile: false,
					createFileIfItDoesntExist: { enabled: false, createWithTemplate: false, template: "" },
					format: { enabled: false, format: "" },
					prepend: false,
					appendLink: false,
					task: false,
					insertAfter: { enabled: false, after: "", insertAtEnd: false, considerSubsections: false, createIfNotFound: false, createIfNotFoundLocation: "" },
					newLineCapture: { enabled: false, direction: "below" },
					openFile: false,
					fileOpening: { location: "tab", direction: "vertical", mode: "default", focus: false }
				} as ICaptureChoice,
				{
					id: "capture-2",
					name: "Capture 2",
					type: "Capture",
					command: false,
					captureTo: "Projects/test.md",
					captureToActiveFile: false,
					createFileIfItDoesntExist: { enabled: false, createWithTemplate: false, template: "" },
					format: { enabled: false, format: "" },
					prepend: false,
					appendLink: false,
					task: false,
					insertAfter: { enabled: false, after: "", insertAtEnd: false, considerSubsections: false, createIfNotFound: false, createIfNotFoundLocation: "" },
					newLineCapture: { enabled: false, direction: "below" },
					openFile: false,
					fileOpening: { location: "tab", direction: "vertical", mode: "default", focus: false }
				} as ICaptureChoice
			];

			const affected = FolderPathUpdater.findChoicesWithFolderPath(choices, "Daily Notes");
			expect(affected).toHaveLength(1);
			expect(affected[0].id).toBe("capture-1");
		});
	});

	describe("isValidFolderPathUpdate", () => {
		it("should return true for valid updates", () => {
			expect(FolderPathUpdater.isValidFolderPathUpdate("Daily Notes", "Journal")).toBe(true);
		});

		it("should return false for identical paths", () => {
			expect(FolderPathUpdater.isValidFolderPathUpdate("Daily Notes", "Daily Notes")).toBe(false);
		});

		it("should return false for empty paths", () => {
			expect(FolderPathUpdater.isValidFolderPathUpdate("", "Journal")).toBe(false);
			expect(FolderPathUpdater.isValidFolderPathUpdate("Daily Notes", "")).toBe(false);
		});
	});
});