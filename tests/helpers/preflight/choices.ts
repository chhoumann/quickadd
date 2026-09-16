import type QuickAdd from "src/main";
import type ICaptureChoice from "src/types/choices/ICaptureChoice";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";

export function createTemplateChoice(templatePath: string): ITemplateChoice {
	return {
		id: "template-choice",
		name: "Template Choice",
		type: "Template",
		command: false,
		templatePath,
		fileNameFormat: { enabled: false, format: "" },
		folder: {
			enabled: false,
			folders: [],
			chooseWhenCreatingNote: false,
			createInSameFolderAsActiveFile: false,
			chooseFromSubfolders: false,
		},
		appendLink: false,
		openFile: false,
		fileOpening: {
			location: "tab",
			direction: "vertical",
			mode: "default",
			focus: true,
		},
		fileExistsBehavior: { kind: "prompt" },
	} as ITemplateChoice;
}


export function createCaptureChoice(captureTo: string): ICaptureChoice {
	return {
		id: "capture-choice",
		name: "Capture Choice",
		type: "Capture",
		command: false,
		captureTo,
		captureToActiveFile: false,
		createFileIfItDoesntExist: {
			enabled: false,
			createWithTemplate: false,
			template: "",
		},
		format: { enabled: false, format: "" },
		prepend: false,
		appendLink: false,
		task: false,
		insertAfter: {
			enabled: false,
			after: "",
			insertAtEnd: false,
			considerSubsections: false,
			createIfNotFound: false,
			createIfNotFoundLocation: "",
		},
		newLineCapture: {
			enabled: false,
			direction: "below",
		},
		openFile: false,
		fileOpening: {
			location: "tab",
			direction: "vertical",
			mode: "default",
			focus: true,
		},
	};
}


export function createPreflightPlugin(useSelectionAsCaptureValue = true): QuickAdd {
	return { settings: {
		inputPrompt: "single-line",
		globalVariables: {},
		useSelectionAsCaptureValue,
	} } as unknown as QuickAdd;
}
