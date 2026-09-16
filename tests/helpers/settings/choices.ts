import type ITemplateChoice from "../../../src/types/choices/ITemplateChoice";

export function templateChoice(overrides: Partial<ITemplateChoice> = {}): ITemplateChoice {
	return {
		id: "t1",
		name: "My Template",
		type: "Template",
		command: false,
		templatePath: "",
		folder: {
			enabled: false,
			folders: [],
			chooseWhenCreatingNote: false,
			createInSameFolderAsActiveFile: false,
			chooseFromSubfolders: false,
		},
		fileNameFormat: { enabled: false, format: "" },
		appendLink: false,
		openFile: false,
		fileOpening: {
			location: "tab",
			direction: "vertical",
			mode: "default",
			focus: true,
		},
		fileExistsBehavior: { kind: "prompt" },
		...overrides,
	};
}
