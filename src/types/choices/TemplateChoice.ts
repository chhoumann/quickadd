import { ChoiceType } from "./choiceType";
import type ITemplateChoice from "./ITemplateChoice";
import { Choice } from "./Choice";
import { NewTabDirection } from "../newTabDirection";
import type { FileViewMode } from "../fileViewMode";
import { fileExistsChoices } from "src/constants";

export class TemplateChoice extends Choice implements ITemplateChoice {
	appendLink: boolean;
	fileNameFormat: { enabled: boolean; format: string };
	folder: {
		enabled: boolean;
		folders: string[];
		chooseWhenCreatingNote: boolean;
		createInSameFolderAsActiveFile: boolean;
		chooseFromSubfolders: boolean;
	};
	openFileInNewTab: {
		enabled: boolean;
		direction: NewTabDirection;
		focus: boolean;
	};
	openFile: boolean;
	openFileInMode: FileViewMode;
	templatePath: string;
	fileExistsMode: typeof fileExistsChoices[number];
	setFileExistsBehavior: boolean;

	constructor(name: string) {
		super(name, ChoiceType.Template);

		this.templatePath = "";
		this.fileNameFormat = { enabled: false, format: "" };
		this.folder = {
			enabled: false,
			folders: [],
			chooseWhenCreatingNote: false,
			createInSameFolderAsActiveFile: false,
			chooseFromSubfolders: false,
		};
		this.appendLink = false;
		this.openFileInNewTab = {
			enabled: false,
			direction: NewTabDirection.vertical,
			focus: true,
		};
		this.openFile = false;
		this.openFileInMode = "default";
		this.fileExistsMode = "Increment the file name";
		this.setFileExistsBehavior = false;
	}

	public static Load(choice: ITemplateChoice): TemplateChoice {
		return choice as TemplateChoice;
	}
}
