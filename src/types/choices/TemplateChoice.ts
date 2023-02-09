import { ChoiceType } from "./choiceType";
import type ITemplateChoice from "./ITemplateChoice";
import { Choice } from "./Choice";
import { NewTabDirection } from "../newTabDirection";
import type { FileViewMode } from "../fileViewMode";

export class TemplateChoice extends Choice implements ITemplateChoice {
	appendLink: boolean;
  chooseFromSubfolders: boolean;
	fileNameFormat: { enabled: boolean; format: string };
	folder: {
		enabled: boolean;
		folders: string[];
		chooseWhenCreatingNote: boolean;
    chooseFromSubfolders: boolean;
		createInSameFolderAsActiveFile: boolean;
	};
	incrementFileName: boolean;
	openFileInNewTab: {
		enabled: boolean;
		direction: NewTabDirection;
		focus: boolean;
	};
	openFile: boolean;
	openFileInMode: FileViewMode;
	templatePath: string;

	constructor(name: string) {
		super(name, ChoiceType.Template);

		this.templatePath = "";
		this.fileNameFormat = { enabled: false, format: "" };
		this.folder = {
			enabled: false,
      chooseFromSubfolders: false,
			folders: [],
			chooseWhenCreatingNote: false,
			createInSameFolderAsActiveFile: false,
		};
		this.appendLink = false;
		this.incrementFileName = false;
		this.openFileInNewTab = {
			enabled: false,
			direction: NewTabDirection.vertical,
			focus: true,
		};
		this.openFile = false;
		this.openFileInMode = "default";
	}

	public static Load(choice: ITemplateChoice): TemplateChoice {
		return choice as TemplateChoice;
	}
}
